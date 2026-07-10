import Link from "next/link";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { createBrand } from "./actions";
import type { Brand } from "@/lib/types";

export default async function BrandsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: brands } = await supabase
    .from("brands")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .neq("status", "archived")
    .order("created_at");

  const createAction = createBrand.bind(null, ws);

  return (
    <div>
      <PageHeader
        title="Бренды"
        subtitle="Каждый бренд имеет собственный профиль: позиционирование, tone of voice и правила генерации."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {(brands as Brand[] | null)?.map((b) => (
          <Link key={b.id} href={`/w/${ws}/brands/${b.id}`} className="card transition hover:border-indigo-300">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{b.name}</p>
              <span
                className={`badge ${
                  b.status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-zinc-100 text-zinc-500"
                }`}
              >
                {b.status === "active" ? "Активен" : "Пауза"}
              </span>
            </div>
            {b.description && (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-500">
                {b.description}
              </p>
            )}
          </Link>
        ))}
      </div>

      {(!brands || brands.length === 0) && (
        <EmptyState
          title="Пока нет брендов"
          description="Создайте первый бренд, чтобы вести контент-план и подключать каналы."
        />
      )}

      {canEditContent(ctx.role) && (
        <form action={createAction} className="card mt-6 space-y-4">
          <input type="hidden" name="workspace_id" value={ctx.workspace.id} />
          <p className="font-medium">Новый бренд</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Название</label>
              <input name="name" className="input" required placeholder="Кофейня «Зерно»" />
            </div>
            <div>
              <label className="label">Часовой пояс</label>
              <select name="timezone" className="input" defaultValue="Europe/Moscow">
                <option value="Europe/Moscow">Москва</option>
                <option value="Asia/Yekaterinburg">Екатеринбург</option>
                <option value="Asia/Novosibirsk">Новосибирск</option>
                <option value="Asia/Vladivostok">Владивосток</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Описание</label>
            <textarea name="description" className="input" rows={2} />
          </div>
          <button className="btn-primary">Создать бренд</button>
        </form>
      )}
    </div>
  );
}
