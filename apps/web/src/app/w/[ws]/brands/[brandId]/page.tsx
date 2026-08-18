import { notFound } from "next/navigation";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  updateBrandProfile,
  archiveBrand,
  addKnowledgeLink,
  uploadKnowledgeFile,
  deleteKnowledgeSource,
} from "../actions";
import type { Brand, BrandProfile, BrandKnowledgeSource } from "@/lib/types";
import { KNOWLEDGE_KIND_LABELS } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

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

  const { data: knowledgeSources } = await supabase
    .from("brand_knowledge_sources")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  const editable = canEditContent(ctx.role);
  const updateAction = updateBrandProfile.bind(null, ws);
  const archiveAction = archiveBrand.bind(null, ws);
  const addLinkAction = addKnowledgeLink.bind(null, ws);
  const uploadFileAction = uploadKnowledgeFile.bind(null, ws);
  const deleteSourceAction = deleteKnowledgeSource.bind(null, ws);

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

        <p className="pt-2 text-sm font-medium text-zinc-700">
          Брендбук — визуальный стиль для генерации картинок
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Фирменные цвета (по одному в строке)</label>
            <textarea
              name="brand_colors"
              className="input"
              rows={3}
              defaultValue={(profile?.brand_colors ?? []).join("\n")}
              disabled={!editable}
              placeholder={"#1A73E8\n#FFFFFF"}
            />
          </div>
          <div>
            <label className="label">Фирменные шрифты (по одному в строке)</label>
            <textarea
              name="fonts"
              className="input"
              rows={3}
              defaultValue={(profile?.fonts ?? []).join("\n")}
              disabled={!editable}
              placeholder={"Montserrat\nOpen Sans"}
            />
          </div>
          <div>
            <label className="label">
              Визуальный стиль / референсы (по одному в строке)
            </label>
            <textarea
              name="visual_references"
              className="input"
              rows={3}
              defaultValue={(profile?.visual_references ?? []).join("\n")}
              disabled={!editable}
              placeholder="Минимализм, плоские иллюстрации, логотип в правом нижнем углу…"
            />
          </div>
        </div>
        {editable && <button className="btn-primary">Сохранить</button>}
      </form>

      <div className="card mt-6 space-y-4">
        <div>
          <p className="font-medium">База знаний бренда</p>
          <p className="text-sm text-zinc-500">
            Редакционный календарь (рубрики, уже выпущенный контент) и брендбук —
            AI обязательно учитывает их при генерации контент-плана.
          </p>
        </div>

        {(!knowledgeSources || knowledgeSources.length === 0) && (
          <EmptyState
            title="База знаний пуста"
            description="Добавьте файл или ссылку на редакционный календарь и брендбук."
          />
        )}

        {knowledgeSources && knowledgeSources.length > 0 && (
          <div className="space-y-2">
            {(knowledgeSources as BrandKnowledgeSource[]).map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded border border-zinc-200 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.title}
                    {s.source_type === "link" && (
                      <a
                        href={s.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs text-indigo-600"
                      >
                        ссылка ↗
                      </a>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {KNOWLEDGE_KIND_LABELS[s.kind]} · {s.source_type === "file" ? "файл" : "ссылка"}
                    {" · "}
                    {formatDateTime(s.created_at)}
                    {s.source_type === "file" &&
                      s.extraction_status !== "done" &&
                      s.extraction_status !== "not_applicable" && (
                        <span className="text-amber-600">
                          {" · "}
                          {s.extraction_status === "unsupported"
                            ? "текст не извлечён (формат не поддержан)"
                            : s.extraction_status === "failed"
                              ? "не удалось извлечь текст"
                              : "обрабатывается"}
                        </span>
                      )}
                  </p>
                </div>
                {editable && (
                  <form action={deleteSourceAction}>
                    <input type="hidden" name="brand_id" value={brand.id} />
                    <input type="hidden" name="source_id" value={s.id} />
                    <ConfirmSubmitButton
                      className="btn-danger"
                      confirmText={`Удалить «${s.title}» из базы знаний?`}
                    >
                      Удалить
                    </ConfirmSubmitButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {editable && (
          <div className="grid gap-4 border-t border-zinc-100 pt-4 md:grid-cols-2">
            <form action={addLinkAction} className="space-y-2">
              <p className="text-sm font-medium">Добавить ссылку</p>
              <input type="hidden" name="brand_id" value={brand.id} />
              <select name="kind" className="input" defaultValue="other">
                <option value="editorial_calendar">Редакционный календарь</option>
                <option value="brand_book">Брендбук</option>
                <option value="other">Другое</option>
              </select>
              <input name="title" className="input" placeholder="Название" required />
              <input
                name="url"
                type="url"
                className="input"
                placeholder="https://…"
                required
              />
              <button className="btn-secondary">Добавить ссылку</button>
            </form>

            <form action={uploadFileAction} className="space-y-2">
              <p className="text-sm font-medium">
                Загрузить файл (PDF, DOCX, TXT, логотип — JPG/PNG/SVG/WEBP)
              </p>
              <input type="hidden" name="brand_id" value={brand.id} />
              <select name="kind" className="input" defaultValue="other">
                <option value="editorial_calendar">Редакционный календарь</option>
                <option value="brand_book">Брендбук</option>
                <option value="other">Другое</option>
              </select>
              <input name="title" className="input" placeholder="Название, например «Логотип»" required />
              <input
                name="file"
                type="file"
                className="input"
                accept=".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.svg,.gif,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
                required
              />
              <button className="btn-secondary">Загрузить</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
