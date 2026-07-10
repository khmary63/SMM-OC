import Link from "next/link";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, ContentStatusBadge } from "@/components/ui";
import type { Brand, ContentItem } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { GeneratePlanForm } from "./generate-form";

export default async function PlansPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const nextMonthStart = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  })();

  const [{ data: planned }, { data: brands }] = await Promise.all([
    supabase
      .from("content_items")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .gte("planned_at", nextMonthStart.toISOString())
      .order("planned_at")
      .limit(100),
    supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
  ]);

  return (
    <div>
      <PageHeader
        title="План следующего месяца"
        subtitle="Черновик плана формируется AI на основе рассчитанной аналитики и принятых рекомендаций (60/25/15). До ручного утверждения остаётся черновиком."
      />

      {canEditContent(ctx.role) && (
        <GeneratePlanForm
          workspaceId={ctx.workspace.id}
          brands={((brands ?? []) as Pick<Brand, "id" | "name">[]).map((b) => ({
            id: b.id,
            name: b.name,
          }))}
        />
      )}

      <div className="mt-6 space-y-2">
        {((planned ?? []) as (ContentItem & { brands: { name: string } | null })[]).map(
          (item) => (
            <Link
              key={item.id}
              href={`/w/${ws}/content/${item.id}`}
              className="card flex items-center gap-3 py-2.5 transition hover:border-indigo-300"
            >
              <span className="w-20 shrink-0 text-sm text-zinc-500">
                {formatDate(item.planned_at)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs text-zinc-400">
                  {item.brands?.name}
                  {item.rubric && ` · ${item.rubric}`}
                </p>
              </div>
              <ContentStatusBadge status={item.status} />
            </Link>
          )
        )}
      </div>

      {(!planned || planned.length === 0) && (
        <div className="mt-6">
          <EmptyState
            title="План на следующий месяц пуст"
            description="Сгенерируйте черновик плана или добавьте материалы вручную через раздел «Контент»."
          />
        </div>
      )}
    </div>
  );
}
