import Link from "next/link";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, ContentStatusBadge } from "@/components/ui";
import { FORMAT_LABELS, GOAL_LABELS } from "@/lib/types";
import type { Brand, ContentItem } from "@/lib/types";
import { createContentItem } from "./actions";
import { formatDateTime } from "@/lib/format";

export default async function ContentPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: items }, { data: brands }] = await Promise.all([
    supabase
      .from("content_items")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active")
      .order("name"),
  ]);

  const createAction = createContentItem.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Контент"
        subtitle="Единицы контента и их адаптации под каналы."
      />

      <div className="space-y-2">
        {(items as (ContentItem & { brands: { name: string } | null })[] | null)?.map(
          (item) => (
            <Link
              key={item.id}
              href={`/w/${ws}/content/${item.id}`}
              className="card flex flex-wrap items-center gap-3 py-3 transition hover:border-indigo-300"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {item.brands?.name ?? "—"} · {FORMAT_LABELS[item.format]}
                  {item.rubric && ` · ${item.rubric}`}
                  {item.goal && ` · ${GOAL_LABELS[item.goal]}`}
                  {item.planned_at && ` · план: ${formatDateTime(item.planned_at)}`}
                </p>
              </div>
              <ContentStatusBadge status={item.status} />
            </Link>
          )
        )}
      </div>

      {(!items || items.length === 0) && (
        <EmptyState
          title="Контента пока нет"
          description="Создайте первую единицу контента — идею, пост или видео."
        />
      )}

      {canEditContent(ctx.role) && (
        <form action={createAction} className="card mt-6 space-y-4">
          <p className="font-medium">Новая единица контента</p>
          {(!brands || brands.length === 0) && (
            <p className="text-sm text-amber-600">Сначала создайте бренд.</p>
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
              <label className="label">Заголовок</label>
              <input name="title" className="input" required placeholder="Как выбрать зерно для эспрессо" />
            </div>
            <div>
              <label className="label">Рубрика</label>
              <input name="rubric" className="input" placeholder="Экспертное" />
            </div>
            <div>
              <label className="label">Формат</label>
              <select name="format" className="input" defaultValue="text">
                {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Цель</label>
              <select name="goal" className="input" defaultValue="">
                <option value="">—</option>
                {Object.entries(GOAL_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Плановая дата</label>
              <input name="planned_at" type="datetime-local" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Тема / бриф</label>
            <textarea
              name="topic"
              className="input"
              rows={2}
              placeholder="О чём материал, ключевые тезисы"
            />
          </div>
          <div>
            <label className="label">Базовый текст (если уже есть)</label>
            <textarea name="base_text" className="input" rows={3} />
          </div>
          <button
            className="btn-primary"
            disabled={!brands || brands.length === 0}
          >
            Создать
          </button>
        </form>
      )}
    </div>
  );
}
