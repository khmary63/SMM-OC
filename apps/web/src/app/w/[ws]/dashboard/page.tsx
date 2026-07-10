import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ContentStatusBadge, PublicationStatusBadge } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ContentItem, Publication } from "@/lib/types";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [
    { count: brandsCount },
    { count: channelsCount },
    { data: upcoming },
    { data: pendingApprovals },
    { data: recentPubs },
    { data: growth },
  ] = await Promise.all([
    supabase
      .from("brands")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
    supabase
      .from("channels")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
    supabase
      .from("content_items")
      .select("id, title, status, planned_at")
      .eq("workspace_id", ctx.workspace.id)
      .gte("planned_at", new Date().toISOString())
      .order("planned_at")
      .limit(5),
    supabase
      .from("approvals")
      .select("id", { count: "exact" })
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "pending"),
    supabase
      .from("publications")
      .select("id, status, scheduled_at, external_url, channels(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("scheduled_at", { ascending: false })
      .limit(5),
    supabase
      .from("v_channel_daily_growth")
      .select("channel_id, local_date, followers, follower_delta")
      .eq("workspace_id", ctx.workspace.id)
      .order("local_date", { ascending: false })
      .limit(10),
  ]);

  const followersTotal = (() => {
    const seen = new Set<string>();
    let total = 0;
    let hasData = false;
    for (const row of growth ?? []) {
      if (seen.has(row.channel_id)) continue;
      seen.add(row.channel_id);
      if (row.followers !== null) {
        total += Number(row.followers);
        hasData = true;
      }
    }
    return hasData ? total : null;
  })();

  const stats = [
    { label: "Активные бренды", value: brandsCount ?? 0, href: `/w/${ws}/brands` },
    { label: "Активные каналы", value: channelsCount ?? 0, href: `/w/${ws}/channels` },
    {
      label: "На согласовании",
      value: pendingApprovals?.length ?? 0,
      href: `/w/${ws}/approvals`,
    },
    {
      label: "Подписчики (сумма)",
      value: followersTotal !== null ? formatNumber(followersTotal) : "—",
      href: `/w/${ws}/analytics`,
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Здравствуйте!`}
        subtitle={`Рабочее пространство «${ctx.workspace.name}».`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card transition hover:border-indigo-300">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="mt-1 text-xs text-zinc-500">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">Ближайший контент</p>
            <Link href={`/w/${ws}/calendar`} className="text-xs text-indigo-600 hover:underline">
              Календарь →
            </Link>
          </div>
          <div className="space-y-2">
            {((upcoming ?? []) as ContentItem[]).map((item) => (
              <Link
                key={item.id}
                href={`/w/${ws}/content/${item.id}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50"
              >
                <span className="w-24 shrink-0 text-xs text-zinc-400">
                  {formatDateTime(item.planned_at)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <ContentStatusBadge status={item.status} />
              </Link>
            ))}
            {(!upcoming || upcoming.length === 0) && (
              <p className="text-sm text-zinc-400">Запланированного контента нет.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">Последние публикации</p>
            <Link href={`/w/${ws}/publications`} className="text-xs text-indigo-600 hover:underline">
              Все →
            </Link>
          </div>
          <div className="space-y-2">
            {((recentPubs ?? []) as unknown as (Publication & {
              channels: { name: string } | null;
            })[]).map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-24 shrink-0 text-xs text-zinc-400">
                  {formatDateTime(p.scheduled_at)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.channels?.name ?? "Канал"}
                </span>
                <PublicationStatusBadge status={p.status} />
              </div>
            ))}
            {(!recentPubs || recentPubs.length === 0) && (
              <p className="text-sm text-zinc-400">Публикаций ещё не было.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
