"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Постановка публикации в очередь через POST /api/publications/schedule. */
export function SchedulePublicationForm({
  ws,
  variantId,
  channelId,
  channelName,
}: {
  ws: string;
  variantId: string;
  channelId: string;
  channelName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/publications/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_variant_id: variantId,
          channel_id: channelId,
          scheduled_at: scheduledAt
            ? new Date(scheduledAt).toISOString()
            : new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка постановки");
      setOpen(false);
      router.push(`/w/${ws}/publications`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        🚀 Запланировать публикацию
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label">Когда опубликовать в «{channelName}»</label>
        <input
          type="datetime-local"
          className="input"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </div>
      <button className="btn-primary" disabled={loading}>
        {loading ? "Ставим…" : "В очередь"}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(false)}
      >
        Отмена
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
