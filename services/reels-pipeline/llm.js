/**
 * Вызов LLM для шагов генерации.
 *
 * Контракт переменных окружения намеренно тот же, что в apps/web/src/lib/ai.ts
 * (AI_PROVIDER / AI_MODEL / AI_BASE_URL / AI_API_KEY / ANTHROPIC_API_KEY),
 * чтобы сервер настраивался один раз и обе части системы ходили в одну модель.
 *
 * Прямой Claude API недоступен из РФ по геоблокировке — на сервере
 * используется AI_PROVIDER=openai с совместимым шлюзом.
 */

const DEFAULT_MODEL = "claude-sonnet-5";

function config(env = process.env) {
  return {
    provider: (env.AI_PROVIDER || "anthropic").toLowerCase(),
    model: env.AI_MODEL || DEFAULT_MODEL,
    baseUrl: (env.AI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: (env.AI_API_KEY || "").trim(),
    anthropicKey: (env.ANTHROPIC_API_KEY || "").trim(),
  };
}

/**
 * Ключ, скопированный из браузера, иногда содержит кириллическую букву,
 * визуально неотличимую от латинской. fetch на таком заголовке падает
 * с невнятной ошибкой, поэтому проверяем заранее и говорим прямо.
 */
function assertAsciiKey(apiKey, name) {
  const bad = [...apiKey].find((c) => c.charCodeAt(0) > 127);
  if (bad) {
    throw new Error(
      `${name} содержит недопустимый (не-латинский) символ «${bad}» — ` +
        "скорее всего кириллица при вводе. Скопируйте ключ заново."
    );
  }
}

async function chatOpenAICompatible({ system, user, maxTokens, cfg, fetchImpl }) {
  if (!cfg.apiKey) throw new Error("AI_API_KEY не настроен (нужен для AI_PROVIDER=openai)");
  assertAsciiKey(cfg.apiKey, "AI_API_KEY");

  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function chatAnthropic({ system, user, maxTokens, cfg, fetchImpl }) {
  if (!cfg.anthropicKey) throw new Error("ANTHROPIC_API_KEY не настроен");
  assertAsciiKey(cfg.anthropicKey, "ANTHROPIC_API_KEY");

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Единая точка вызова: system + user → текст ответа. */
async function chat(system, user, { maxTokens = 2000, env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  const args = { system, user, maxTokens, cfg, fetchImpl };
  return cfg.provider === "openai"
    ? chatOpenAICompatible(args)
    : chatAnthropic(args);
}

module.exports = { chat, config, assertAsciiKey, DEFAULT_MODEL };
