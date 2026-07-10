import { requireWorkspace, canAdmin } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, ConnectionStatusBadge } from "@/components/ui";
import { PLATFORM_LABELS } from "@/lib/types";
import type { Brand, Channel } from "@/lib/types";
import { connectChannel, disconnectChannel, syncChannelMetrics } from "./actions";
import { formatDateTime } from "@/lib/format";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: channels }, { data: brands }] = await Promise.all([
    supabase
      .from("channels")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at"),
    supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active")
      .order("name"),
  ]);

  const admin = canAdmin(ctx.role);
  const connectAction = connectChannel.bind(null, ws);
  const disconnectAction = disconnectChannel.bind(null, ws);
  const syncAction = syncChannelMetrics.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Каналы"
        subtitle="Подключённые площадки. Токены хранятся в защищённом хранилище и не попадают в браузер."
      />

      <div className="space-y-3">
        {(channels as (Channel & { brands: { name: string } | null })[] | null)?.map(
          (c) => (
            <div key={c.id} className="card flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{c.name}</p>
                  <ConnectionStatusBadge status={c.status} />
                </div>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {PLATFORM_LABELS[c.platform]} · {c.brands?.name ?? "—"}
                  {c.username && ` · @${c.username}`}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Синхронизация: {formatDateTime(c.last_sync_at)}
                  {c.sync_error && (
                    <span className="text-red-500"> · {c.sync_error}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <form action={syncAction}>
                  <input type="hidden" name="channel_id" value={c.id} />
                  <button className="btn-secondary">Синхронизировать</button>
                </form>
                {admin && c.status !== "disabled" && (
                  <form action={disconnectAction}>
                    <input type="hidden" name="channel_id" value={c.id} />
                    <button className="btn-danger">Отключить</button>
                  </form>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {(!channels || channels.length === 0) && (
        <EmptyState
          title="Каналы не подключены"
          description="Подключите VK, Telegram или MAX, чтобы публиковать контент и собирать метрики."
        />
      )}

      {admin && (
        <form action={connectAction} className="card mt-6 space-y-4">
          <p className="font-medium">Подключить канал</p>
          {(!brands || brands.length === 0) && (
            <p className="text-sm text-amber-600">
              Сначала создайте бренд — канал привязывается к бренду.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Бренд</label>
              <select name="brand_id" className="input" required>
                {(brands as Pick<Brand, "id" | "name">[] | null)?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Платформа</label>
              <select name="platform" className="input" required>
                <option value="telegram">Telegram</option>
                <option value="vk">ВКонтакте</option>
                <option value="max">MAX</option>
              </select>
            </div>
            <div>
              <label className="label">Название канала</label>
              <input name="name" className="input" required placeholder="Основной канал" />
            </div>
            <div>
              <label className="label">
                ID канала (chat_id / owner_id / group_id)
              </label>
              <input
                name="external_channel_id"
                className="input"
                placeholder="-1001234567890 или -123456"
              />
            </div>
            <div>
              <label className="label">Username (без @)</label>
              <input name="username" className="input" placeholder="mychannel" />
            </div>
            <div>
              <label className="label">Публичная ссылка</label>
              <input name="public_url" className="input" placeholder="https://t.me/mychannel" />
            </div>
          </div>
          <div>
            <label className="label">
              Токен (bot token / access token) — сохраняется в защищённом хранилище
            </label>
            <input name="token" className="input" type="password" placeholder="Можно добавить позже" />
          </div>
          <button className="btn-primary" disabled={!brands || brands.length === 0}>
            Подключить
          </button>
        </form>
      )}
    </div>
  );
}
