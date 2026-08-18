import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * AI-провайдер выбирается переменной AI_PROVIDER:
 *  - "anthropic"  — прямой Claude API (недоступен из РФ по геоблокировке);
 *  - "openai"     — любой OpenAI-совместимый endpoint (OpenRouter, российские
 *                   шлюзы, self-hosted прокси). Задаётся AI_BASE_URL + AI_API_KEY.
 */
const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const MODEL = process.env.AI_MODEL || "claude-sonnet-5";

/**
 * Единая точка вызова LLM. Принимает system+user, возвращает текст ответа.
 * Обе ветки просят модель отвечать чистым JSON — парсинг общий (ниже).
 */
async function chat(system: string, user: string, maxTokens: number): Promise<string> {
  if (PROVIDER === "openai") {
    return chatOpenAICompatible(system, user, maxTokens);
  }
  return chatAnthropic(system, user, maxTokens);
}

async function chatAnthropic(
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY не настроен");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

async function chatOpenAICompatible(
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  const baseUrl = (process.env.AI_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    ""
  );
  const apiKey = (process.env.AI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("AI_API_KEY не настроен (нужен для AI_PROVIDER=openai)");
  }
  // Защита от гомоглифов: кириллический символ в ключе роняет заголовок fetch.
  const badChar = [...apiKey].find((c) => c.charCodeAt(0) > 127);
  if (badChar) {
    throw new Error(
      `AI_API_KEY содержит недопустимый (не-латинский) символ «${badChar}» — ` +
        "скорее всего кириллица при вводе. Скопируйте ключ заново."
    );
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI provider ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider вернул пустой ответ");
  return content;
}

export interface BrandContext {
  name: string;
  positioning?: string | null;
  tone_of_voice?: string | null;
  prohibited_topics?: string[];
  prohibited_phrases?: string[];
  prompt_rules?: string | null;
  brand_colors?: string[];
  fonts?: string[];
  visual_references?: string[];
}

/** Текстовое описание визуального стиля бренда для промптов генерации картинок. */
export function buildBrandStyleDirective(brand: BrandContext): string | null {
  const parts = [
    brand.brand_colors?.length &&
      `фирменные цвета: ${brand.brand_colors.join(", ")}`,
    brand.fonts?.length && `фирменные шрифты: ${brand.fonts.join(", ")}`,
    brand.visual_references?.length &&
      `визуальные референсы/стиль: ${brand.visual_references.join("; ")}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Выдержи фирменный стиль бренда «${brand.name}»: ${parts.join("; ")}.`;
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

  const text = await chat(system, user, 4000);
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
  /** Свободные инструкции пользователя для конкретно этой генерации. */
  instructions?: string | null;
  /** Текст из базы знаний бренда (редакционный календарь, брендбук — файлы и ссылки). */
  knowledgeBase?: string | null;
}): Promise<{ summary: string; topics: PlanTopic[] }> {
  const system = [
    "Ты — контент-стратег платформы MARIA SMM OS.",
    "Планируй по правилу распределения 60% проверенный контент / 25% развитие / 15% эксперименты.",
    "Каждая экспериментальная тема должна содержать проверяемую гипотезу.",
    params.knowledgeBase &&
      "Тебе передана база знаний бренда (редакционный календарь с рубриками и уже выпущенным контентом, брендбук). " +
        "Обязательно опирайся на неё: используй существующие рубрики вместо выдуманных, не повторяй уже выпущенные темы дословно, соблюдай стиль из брендбука.",
    params.instructions &&
      "Пользователь передал инструкции для этой генерации — они имеют приоритет над твоими общими предположениями, но не должны нарушать запрещённые темы/фразы бренда.",
    'Отвечай СТРОГО валидным JSON: {"summary":"", "topics":[{"date":"YYYY-MM-DD","title","rubric","format","goal","hypothesis"}]}. Без markdown.',
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Бренд: ${params.brand.name}. ${params.brand.positioning ?? ""}`,
    `Месяц планирования: ${params.month}. Частота: ~${params.postsPerWeek} постов в неделю.`,
    `Итоги прошлого периода (агрегаты): ${JSON.stringify(params.performanceSummary)}`,
    params.acceptedRecommendations.length
      ? `Принятые рекомендации: ${JSON.stringify(params.acceptedRecommendations)}`
      : "Принятых рекомендаций нет.",
    params.instructions && `Инструкции пользователя для этого плана:\n${params.instructions}`,
    params.knowledgeBase && `База знаний бренда:\n${params.knowledgeBase}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = await chat(system, user, 8000);
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
  const system = [
    "Ты — аналитик платформы MARIA SMM OS.",
    "Тебе передают уже рассчитанные агрегаты. Не выдумывай числа: каждое числовое утверждение должно опираться на переданный evidence.",
    "При sample_size < 10 указывай confidence не выше low; при < 3 — insufficient.",
    'Отвечай СТРОГО валидным JSON: {"summary":"", "recommendations":[{"action","reason","evidence":[],"confidence":"high|medium|low|insufficient","test_metric","test_period_days":30}]}. Без markdown.',
  ].join("\n");

  const text = await chat(system, JSON.stringify(evidenceJson), 6000);
  return parseJsonObject(text);
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Генерация изображения (WF-CONTENT-002). Провайдер настраивается, а не
 * зашивается в workflow (§16.9): используется тот же OpenAI-совместимый
 * шлюз, что и для текста (AI_BASE_URL/AI_API_KEY), endpoint /images/generations.
 * Для AI_PROVIDER=anthropic (нет images API) — явная ошибка с инструкцией.
 */
export async function generateImage(params: {
  prompt: string;
  dimensions?: string; // "1024x1024"
  /** Директива фирменного стиля (см. buildBrandStyleDirective) — добавляется к промпту. */
  brandStyle?: string | null;
}): Promise<GeneratedImage> {
  if (PROVIDER !== "openai") {
    throw new Error(
      "Генерация изображений требует AI_PROVIDER=openai с images-совместимым " +
        "шлюзом (AI_BASE_URL/AI_API_KEY). Текущий провайдер: " +
        `${PROVIDER}.`
    );
  }

  const fullPrompt = params.brandStyle
    ? `${params.prompt}\n\n${params.brandStyle}`
    : params.prompt;

  const baseUrl = (process.env.AI_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    ""
  );
  const apiKey = (process.env.AI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("AI_API_KEY не настроен (нужен для AI_PROVIDER=openai)");
  }
  const badChar = [...apiKey].find((c) => c.charCodeAt(0) > 127);
  if (badChar) {
    throw new Error(
      `AI_API_KEY содержит недопустимый (не-латинский) символ «${badChar}»`
    );
  }

  const imageModel = process.env.AI_IMAGE_MODEL || "dall-e-3";
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: imageModel,
      prompt: fullPrompt,
      size: params.dimensions || "1024x1024",
      n: 1,
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image provider ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) {
    return { bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
  }
  if (item?.url) {
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!imgRes.ok) throw new Error(`Не удалось скачать сгенерированное изображение: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return { bytes: buf, mimeType: imgRes.headers.get("content-type") || "image/png" };
  }
  throw new Error("Image provider не вернул изображение");
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
