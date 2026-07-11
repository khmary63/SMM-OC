"use client";

import { useActionState } from "react";
import {
  createApiKeyAction,
  createWebhookAction,
  type SecretResult,
} from "./integration-actions";

const EVENT_LABELS: Record<string, string> = {
  "content.created": "Контент создан",
  "content.approved": "Контент согласован",
  "content.revision_requested": "Отправлен на доработку",
  "publication.queued": "Публикация в очереди",
  "publication.published": "Опубликовано",
  "publication.failed": "Ошибка публикации",
  "publication.cancelled": "Публикация отменена",
  "metrics.collected": "Метрики собраны",
  "report.generated": "Отчёт готов",
  "recommendation.generated": "Новая рекомендация",
};

function SecretBanner({ result, label }: { result: SecretResult | null; label: string }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {result.error}
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <p className="font-medium">{label} — сохраните, показывается один раз:</p>
      <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">
        {result.secret}
      </code>
    </div>
  );
}

export function CreateApiKeyForm({ ws }: { ws: string }) {
  const [result, action, pending] = useActionState<SecretResult | null, FormData>(
    (prev, formData) => createApiKeyAction(ws, prev, formData),
    null
  );

  return (
    <form action={action} className="space-y-3">
      <SecretBanner result={result} label="Ваш API-ключ" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label className="label">Название ключа</label>
          <input name="name" className="input" placeholder="Zapier / Make / мой сервис" />
        </div>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Создаём…" : "Создать API-ключ"}
        </button>
      </div>
    </form>
  );
}

export function CreateWebhookForm({
  ws,
  events,
}: {
  ws: string;
  events: readonly string[];
}) {
  const [result, action, pending] = useActionState<SecretResult | null, FormData>(
    (prev, formData) => createWebhookAction(ws, prev, formData),
    null
  );

  return (
    <form action={action} className="space-y-3">
      <SecretBanner result={result} label="Секрет подписи (whsec_…)" />
      <div>
        <label className="label">URL приёмника</label>
        <input
          name="url"
          className="input"
          placeholder="https://your-service.ru/hooks/maria"
          required
        />
      </div>
      <div>
        <label className="label">
          События (ничего не отмечено = все события)
        </label>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {events.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name={`event:${e}`} className="rounded" />
              {EVENT_LABELS[e] ?? e}
              <span className="text-xs text-zinc-400">({e})</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Описание</label>
        <input name="description" className="input" placeholder="Интеграция с CRM" />
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Создаём…" : "Добавить вебхук"}
      </button>
    </form>
  );
}
