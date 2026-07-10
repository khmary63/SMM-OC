import { notFound } from "next/navigation";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { updateBrandProfile, archiveBrand } from "../actions";
import type { Brand, BrandProfile } from "@/lib/types";

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ ws: string; brandId: string }>;
}) {
  const { ws, brandId } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle<Brand>();
  if (!brand) notFound();

  const { data: profile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle<BrandProfile>();

  const editable = canEditContent(ctx.role);
  const updateAction = updateBrandProfile.bind(null, ws);
  const archiveAction = archiveBrand.bind(null, ws);

  return (
    <div>
      <PageHeader
        title={brand.name}
        subtitle="Профиль бренда используется AI-генерацией и планированием."
        action={
          editable ? (
            <form action={archiveAction}>
              <input type="hidden" name="brand_id" value={brand.id} />
              <button className="btn-danger">Архивировать</button>
            </form>
          ) : undefined
        }
      />

      <form action={updateAction} className="card space-y-4">
        <input type="hidden" name="brand_id" value={brand.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Название</label>
            <input
              name="name"
              className="input"
              defaultValue={brand.name}
              disabled={!editable}
              required
            />
          </div>
          <div>
            <label className="label">Статус</label>
            <select
              name="status"
              className="input"
              defaultValue={brand.status}
              disabled={!editable}
            >
              <option value="active">Активен</option>
              <option value="paused">Пауза</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Описание</label>
          <textarea
            name="description"
            className="input"
            rows={2}
            defaultValue={brand.description ?? ""}
            disabled={!editable}
          />
        </div>
        <div>
          <label className="label">Позиционирование</label>
          <textarea
            name="positioning"
            className="input"
            rows={3}
            defaultValue={profile?.positioning ?? ""}
            disabled={!editable}
            placeholder="Что делает бренд, для кого и чем отличается"
          />
        </div>
        <div>
          <label className="label">Tone of voice</label>
          <textarea
            name="tone_of_voice"
            className="input"
            rows={2}
            defaultValue={profile?.tone_of_voice ?? ""}
            disabled={!editable}
            placeholder="Дружелюбный, экспертный, без канцелярита…"
          />
        </div>
        <div>
          <label className="label">Правила для AI-генерации</label>
          <textarea
            name="prompt_rules"
            className="input"
            rows={3}
            defaultValue={profile?.prompt_rules ?? ""}
            disabled={!editable}
            placeholder="Обращение на «вы», всегда упоминать город, не обещать скидок…"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Запрещённые темы (по одной в строке)</label>
            <textarea
              name="prohibited_topics"
              className="input"
              rows={3}
              defaultValue={(profile?.prohibited_topics ?? []).join("\n")}
              disabled={!editable}
            />
          </div>
          <div>
            <label className="label">Запрещённые фразы (по одной в строке)</label>
            <textarea
              name="prohibited_phrases"
              className="input"
              rows={3}
              defaultValue={(profile?.prohibited_phrases ?? []).join("\n")}
              disabled={!editable}
            />
          </div>
        </div>
        {editable && <button className="btn-primary">Сохранить</button>}
      </form>
    </div>
  );
}
