import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ContentStatusBadge } from "@/components/ui";
import type { ContentItem } from "@/lib/types";

function monthRange(ym: string): { start: Date; end: Date } {
  const [y, m] = ym.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { ws } = await params;
  const { month } = await searchParams;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const now = new Date();
  const ym =
    month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { start, end } = monthRange(ym);

  const { data: items } = await supabase
    .from("content_items")
    .select("id, title, status, planned_at, format, brands(name)")
    .eq("workspace_id", ctx.workspace.id)
    .gte("planned_at", start.toISOString())
    .lt("planned_at", end.toISOString())
    .order("planned_at");

  // Сетка месяца: недели начинаются с понедельника
  const firstWeekday = (start.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    0
  ).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<number, (ContentItem & { brands: { name: string } | null })[]>();
  for (const item of (items ?? []) as unknown as (ContentItem & {
    brands: { name: string } | null;
  })[]) {
    if (!item.planned_at) continue;
    const day = new Date(item.planned_at).getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  const monthTitle = start.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <PageHeader
        title="Контент-календарь"
        subtitle="Плановые даты единиц контента."
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/w/${ws}/calendar?month=${shiftMonth(ym, -1)}`}
              className="btn-secondary"
            >
              ←
            </Link>
            <span className="min-w-36 text-center text-sm font-medium capitalize">
              {monthTitle}
            </span>
            <Link
              href={`/w/${ws}/calendar?month=${shiftMonth(ym, 1)}`}
              className="btn-secondary"
            >
              →
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 text-xs">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <div key={d} className="bg-zinc-50 px-2 py-1.5 font-medium text-zinc-500">
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-24 bg-white p-1.5">
            {day && (
              <>
                <p className="mb-1 text-right text-xs text-zinc-400">{day}</p>
                <div className="space-y-1">
                  {byDay.get(day)?.map((item) => (
                    <Link
                      key={item.id}
                      href={`/w/${ws}/content/${item.id}`}
                      className="block truncate rounded bg-indigo-50 px-1.5 py-1 text-indigo-700 hover:bg-indigo-100"
                      title={item.title}
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {((items ?? []) as unknown as (ContentItem & { brands: { name: string } | null })[]).map(
          (item) => (
            <Link
              key={item.id}
              href={`/w/${ws}/content/${item.id}`}
              className="card flex items-center gap-3 py-2.5"
            >
              <span className="w-14 text-sm text-zinc-500">
                {item.planned_at
                  ? new Date(item.planned_at).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                    })
                  : "—"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="hidden text-xs text-zinc-400 sm:block">
                {item.brands?.name}
              </span>
              <ContentStatusBadge status={item.status} />
            </Link>
          )
        )}
      </div>
    </div>
  );
}
