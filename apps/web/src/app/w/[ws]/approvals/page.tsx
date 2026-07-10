import Link from "next/link";
import { requireWorkspace, canApprove } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { decideApproval } from "../content/actions";
import { formatDateTime } from "@/lib/format";

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: approvals } = await supabase
    .from("approvals")
    .select(
      `id, status, version_no, requested_at, comment,
       content_variants(id, title, body, content_item_id,
         content_items(title, brands(name)),
         channels(name, platform))`
    )
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "pending")
    .order("requested_at");

  const { data: history } = await supabase
    .from("approvals")
    .select(
      `id, status, version_no, decided_at, comment,
       content_variants(content_item_id, content_items(title))`
    )
    .eq("workspace_id", ctx.workspace.id)
    .neq("status", "pending")
    .order("decided_at", { ascending: false })
    .limit(20);

  const approver = canApprove(ctx.role);
  const decideAction = decideApproval.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Согласование"
        subtitle="Каждое согласование привязано к конкретной версии варианта."
      />

      <div className="space-y-4">
        {approvals?.map((a) => {
          const variant = a.content_variants as unknown as {
            id: string;
            title: string | null;
            body: string | null;
            content_item_id: string;
            content_items: { title: string; brands: { name: string } | null } | null;
            channels: { name: string; platform: string } | null;
          } | null;
          return (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/w/${ws}/content/${variant?.content_item_id}`}
                  className="font-medium text-indigo-700 hover:underline"
                >
                  {variant?.content_items?.title ?? "Материал"}
                </Link>
                <span className="badge bg-zinc-100 text-zinc-600">
                  v{a.version_no}
                </span>
                {variant?.channels && (
                  <span className="badge bg-sky-50 text-sky-700">
                    {variant.channels.name}
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-400">
                  {formatDateTime(a.requested_at)}
                </span>
              </div>
              {variant?.body && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">
                  {variant.body.length > 600
                    ? `${variant.body.slice(0, 600)}…`
                    : variant.body}
                </p>
              )}
              {approver && (
                <form
                  action={decideAction}
                  className="mt-4 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="approval_id" value={a.id} />
                  <div className="min-w-56 flex-1">
                    <label className="label">Комментарий (для доработки)</label>
                    <input name="comment" className="input" />
                  </div>
                  <button
                    name="decision"
                    value="approved"
                    className="btn-primary"
                  >
                    Согласовать
                  </button>
                  <button
                    name="decision"
                    value="rejected"
                    className="btn-danger"
                  >
                    На доработку
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {(!approvals || approvals.length === 0) && (
        <EmptyState
          title="Нет материалов на согласовании"
          description="Отправьте вариант на согласование со страницы контента."
        />
      )}

      {history && history.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">История</h2>
          <div className="space-y-2">
            {history.map((h) => {
              const variant = h.content_variants as unknown as {
                content_item_id: string;
                content_items: { title: string } | null;
              } | null;
              return (
                <div key={h.id} className="card flex items-center gap-3 py-2.5">
                  <span
                    className={`badge ${
                      h.status === "approved"
                        ? "bg-emerald-50 text-emerald-700"
                        : h.status === "rejected"
                          ? "bg-orange-50 text-orange-700"
                          : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {h.status === "approved"
                      ? "Согласовано"
                      : h.status === "rejected"
                        ? "Доработка"
                        : "Отменено"}
                  </span>
                  <Link
                    href={`/w/${ws}/content/${variant?.content_item_id}`}
                    className="min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {variant?.content_items?.title ?? "Материал"} · v
                    {h.version_no}
                  </Link>
                  {h.comment && (
                    <span className="hidden max-w-64 truncate text-xs text-zinc-400 md:block">
                      {h.comment}
                    </span>
                  )}
                  <span className="text-xs text-zinc-400">
                    {formatDateTime(h.decided_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
