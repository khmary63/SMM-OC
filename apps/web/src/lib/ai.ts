import "server-only";

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.AI_MODEL || "claude-sonnet-5";

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY не настроен");
  }
  return new Anthropic();
}

export interface BrandContext {
  name: string;
  positioning?: string | null;
  tone_of_voice?: string | null;
  prohibited_topics?: string[];
  prohibited_phrases?: string[];
  prompt_rules?: string | null;
}

export interface GeneratedVariant {
  platform: string;
  title: string;
  body: string;
  hook: string;
  cta: string;
  hashtags: string[];
}

/**
 * Генерация адаптаций поста под платформы.
 * AI никогда не переводит материал в approved — только черновики (§ WF-CONTENT-001).
 */
export async function generateContentCopy(params: {
  brand: BrandContext;
  topic: string;
  rubric?: string | null;
  goal?: string | null;
  format?: string | null;
  baseText?: string | null;
  platforms: string[];
}): Promise<GeneratedVariant[]> {
  const client = getClient();

  const system = [
    "Ты — SMM-копирайтер платформы MARIA SMM OS.",
    "Пиши на русском языке, если бренд не требует иного.",
    `Бренд: ${params.brand.name}.`,
    params.brand.positioning && `Позиционирование: ${params.brand.positioning}`,
    params.brand.tone_of_voice && `Tone of voice: ${params.brand.tone_of_voice}`,
    params.brand.prompt_rules && `Правила бренда: ${params.brand.prompt_rules}`,
    params.brand.prohibited_topics?.length &&
      `Запрещённые темы: ${params.brand.prohibited_topics.join(", ")}`,
    params.brand.prohibited_phrases?.length &&
      `Запрещённые фразы: ${params.brand.prohibited_phrases.join(", ")}`,
    "Учитывай ограничения платформ: Telegram — caption до 1024 символов при медиа; VK — свободная длина; MAX — краткие сообщения.",
    'Отвечай СТРОГО валидным JSON-массивом объектов: [{"platform","title","body","hook","cta","hashtags":[]}]. Без markdown-обёртки.',
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Тема: ${params.topic}`,
    params.rubric && `Рубрика: ${params.rubric}`,
    params.goal && `Цель: ${params.goal}`,
    params.format && `Формат: ${params.format}`,
    params.baseText && `Базовый текст:\n${params.baseText}`,
    `Сгенерируй адаптации для платформ: ${params.platforms.join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const variants = parseJsonArray<GeneratedVariant>(text);

  // Контроль запрещённых фраз (шаг 6 WF-CONTENT-001)
  const banned = (params.brand.prohibited_phrases ?? []).map((p) =>
    p.toLowerCase()
  );
  for (const v of variants) {
    const full = `${v.title} ${v.body} ${v.hook} ${v.cta}`.toLowerCase();
    const hit = banned.find((p) => p && full.includes(p));
    if (hit) {
      throw new Error(`Сгенерированный текст содержит запрещённую фразу: «${hit}»`);
    }
  }

  return variants;
}

export interface PlanTopic {
  date: string;
  title: string;
  rubric: string;
  format: string;
  goal: string;
  hypothesis: string;
}

/** Черновик контент-плана следующего месяца (WF-AN-005). Остаётся черновиком до ручного утверждения. */
export async function generateNextMonthPlan(params: {
  brand: BrandContext;
  month: string; // YYYY-MM
  postsPerWeek: number;
  performanceSummary: Record<string, unknown>;
  acceptedRecommendations: { action: string; reason: string }[];
}): Promise<{ summary: string; topics: PlanTopic[] }> {
  const client = getClient();

  const system = [
    "Ты — контент-стратег платформы MARIA SMM OS.",
    "Планируй по правилу распределения 60% проверенный контент / 25% развитие / 15% эксперименты.",
    "Каждая экспериментальная тема должна содержать проверяемую гипотезу.",
    'Отвечай СТРОГО валидным JSON: {"summary":"", "topics":[{"date":"YYYY-MM-DD","title","rubric","format","goal","hypothesis"}]}. Без markdown.',
  ].join("\n");

  const user = [
    `Бренд: ${params.brand.name}. ${params.brand.positioning ?? ""}`,
    `Месяц планирования: ${params.month}. Частота: ~${params.postsPerWeek} постов в неделю.`,
    `Итоги прошлого периода (агрегаты): ${JSON.stringify(params.performanceSummary)}`,
    params.acceptedRecommendations.length
      ? `Принятые рекомендации: ${JSON.stringify(params.acceptedRecommendations)}`
      : "Принятых рекомендаций нет.",
  ].join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  return parseJsonObject(text);
}

export interface InsightResult {
  summary: string;
  recommendations: {
    action: string;
    reason: string;
    evidence: unknown[];
    confidence: "high" | "medium" | "low" | "insufficient";
    test_metric: string;
    test_period_days: number;
  }[];
}

/**
 * Интерпретация УЖЕ рассчитанных показателей (§12 архитектуры).
 * LLM не считает метрики и не получает сырые цифры без агрегации.
 */
export async function generateInsights(
  evidenceJson: Record<string, unknown>
): Promise<InsightResult> {
  const client = getClient();

  const system = [
    "Ты — аналитик платформы MARIA SMM OS.",
    "Тебе передают уже рассчитанные агрегаты. Не выдумывай числа: каждое числовое утверждение должно опираться на переданный evidence.",
    "При sample_size < 10 указывай confidence не выше low; при < 3 — insufficient.",
    'Отвечай СТРОГО валидным JSON: {"summary":"", "recommendations":[{"action","reason","evidence":[],"confidence":"high|medium|low|insufficient","test_metric","test_period_days":30}]}. Без markdown.',
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: JSON.stringify(evidenceJson) }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  return parseJsonObject(text);
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function parseJsonArray<T>(text: string): T[] {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("AI вернул невалидный JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function parseJsonObject<T = never>(text: string): T {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI вернул невалидный JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}
