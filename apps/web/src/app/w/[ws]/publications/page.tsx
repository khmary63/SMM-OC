import { requireWorkspace, canPublish } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, PublicationStatusBadge } from "@/components/ui";
import { PLATFORM_LABELS } from "@/lib/types";
import type { ChannelPlatform, Publication } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { cancelPublicationAction, retryPublicationAction } from "./actions";

type Row = Publication & {
  channels: { name: string; platform: ChannelPlatform } | null;
  content_variants: {
    title: string | null;
    content_items: { title: string } | null;
  } | null;
};

export default async function PublicationsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: publications } = await supabase
    .from("publications")
    .select(
      `*, channels(name, platform),
       content_variants(title, content_items(title))`
    )
    .eq("workspace_id", ctx.workspace.id)
    .order("scheduled_at", { ascending: false })
    .limit(100);

  const publisher = canPublish(ctx.role);
  const cancelAction = cancelPublicationAction.bind(null, ws);
  const retryAction = retryPublicationAction.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Публикации"
        subtitle="Очередь и история. Каждая публикация защищена idempotency key от дублей."
      />

      <div className="space-y-2">
        {((publications ?? []) as Row[]).map((p) => (
          <div key={p.id} className="card flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.content_variants?.content_items?.title ??
                  p.content_variants?.title ??
                  "Публикация"}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {p.channels
                  ? `${PLATFORM_LABELS[p.channels.platform]} · ${p.channels.name}`
                  : "—"}{" "}
                · план: {formatDateTime(p.scheduled_at)}
                {p.published_at && ` · факт: ${formatDateTime(p.published_at)}`}
                {p.attempt_count > 0 && ` · попыток: ${p.attempt_count}`}
              </p>
              {p.failure_message && (
                <p className="mt-0.5 text-xs text-red-500">
                  {p.failure_code && `[${p.failure_code}] `}
                  {p.failure_message}
                </p>
              )}
            </div>
            <PublicationStatusBadge status={p.status} />
            {p.external_url && (
              <a
                href={p.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                Открыть пост
              </a>
            )}
            {publisher && ["queued", "failed", "draft"].includes(p.status) && (
              <form action={cancelAction}>
                <input type="hidden" name="publication_id" value={p.id} />
                <button className="btn-danger">Отменить</button>
              </form>
            )}
            {publisher && p.status === "failed" && (
              <form action={retryAction}>
                <input type="hidden" name="publication_id" value={p.id} />
                <button className="btn-secondary">Повторить</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {(!publications || publications.length === 0) && (
        <EmptyState
          title="Публикаций пока нет"
          description="Согласуйте вариант контента и запланируйте публикацию с его страницы."
        />
      )}
    </div>
  );
}
