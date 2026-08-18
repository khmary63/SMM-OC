import { notFound } from "next/navigation";
import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ContentStatusBadge } from "@/components/ui";
import { FORMAT_LABELS, GOAL_LABELS, PLATFORM_LABELS } from "@/lib/types";
import type { Asset, Channel, ContentItem, ContentVariant } from "@/lib/types";
import {
  updateContentItem,
  saveVariant,
  generateVariants,
  requestApproval,
} from "../actions";
import { SchedulePublicationForm } from "./schedule-form";
import { AttachedMedia, type MediaAsset } from "./attach-media";

export default async function ContentItemPage({
  params,
}: {
  params: Promise<{ ws: string; itemId: string }>;
}) {
  const { ws, itemId } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("content_items")
    .select("*, brands(name)")
    .eq("id", itemId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle<ContentItem & { brands: { name: string } | null }>();
  if (!item) notFound();

  const [{ data: variants }, { data: channels }, { data: attachedRows }, { data: brandAssets }] =
    await Promise.all([
      supabase
        .from("content_variants")
        .select("*")
        .eq("content_item_id", itemId)
        .order("channel_id", { ascending: true, nullsFirst: true })
        .order("version_no", { ascending: false }),
      supabase
        .from("channels")
        .select("*")
        .eq("brand_id", item.brand_id)
        .neq("status", "disabled")
        .order("name"),
      supabase
        .from("content_item_assets")
        .select("asset_id, sort_order, assets(*)")
        .eq("content_item_id", itemId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("assets")
        .select("*")
        .eq("workspace_id", ctx.workspace.id)
        .or(`brand_id.eq.${item.brand_id},brand_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  const editable = canEditContent(ctx.role);

  const attachedAssets = (
    (attachedRows ?? []) as unknown as { asset_id: string; assets: Asset | null }[]
  )
    .map((r) => r.assets)
    .filter((a): a is Asset => a !== null);
  const attachedIds = new Set(attachedAssets.map((a) => a.id));
  const availableAssets = ((brandAssets ?? []) as Asset[]).filter(
    (a) => !attachedIds.has(a.id)
  );

  const imageAssets = [...attachedAssets, ...availableAssets].filter((a) =>
    a.mime_type?.startsWith("image/")
  );
  const signedUrls = new Map<string, string>();
  if (imageAssets.length > 0) {
    const { data: signed } = await supabase.storage
      .from("smm-assets")
      .createSignedUrls(
        imageAssets.map((a) => a.storage_path),
        3600
      );
    signed?.forEach((s, i) => {
      if (s.signedUrl) signedUrls.set(imageAssets[i].id, s.signedUrl);
    });
  }

  const toMediaAsset = (a: Asset): MediaAsset => ({
    id: a.id,
    fileName: a.file_name,
    type: a.type,
    url: signedUrls.get(a.id),
  });
  const updateAction = updateContentItem.bind(null, ws);
  const saveVariantAction = saveVariant.bind(null, ws);
  const generateAction = generateVariants.bind(null, ws);
  const approvalAction = requestApproval.bind(null, ws);

  const channelById = new Map(
    ((channels as Channel[] | null) ?? []).map((c) => [c.id, c])
  );

  // Показываем только последнюю версию каждой связки (item, channel)
  const latestByChannel = new Map<string, ContentVariant>();
  for (const v of (variants as ContentVariant[] | null) ?? []) {
    const key = v.channel_id ?? "base";
    if (!latestByChannel.has(key)) latestByChannel.set(key, v);
  }

  const toLocalInput = (iso: string | null) =>
    iso ? new Date(iso).toISOString().slice(0, 16) : "";

  return (
    <div>
      <PageHeader
        title={item.title}
        subtitle={`${item.brands?.name ?? ""} · ${FORMAT_LABELS[item.format]}`}
        action={<ContentStatusBadge status={item.status} />}
      />

      <form action={updateAction} className="card space-y-4">
        <input type="hidden" name="content_item_id" value={item.id} />
        <p className="font-medium">Карточка</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="label">Заголовок</label>
            <input
              name="title"
              className="input"
              defaultValue={item.title}
              disabled={!editable}
              required
            />
          </div>
          <div>
            <label className="label">Плановая дата</label>
            <input
              name="planned_at"
              type="datetime-local"
              className="input"
              defaultValue={toLocalInput(item.planned_at)}
              disabled={!editable}
            />
          </div>
          <div>
            <label className="label">Рубрика</label>
            <input
              name="rubric"
              className="input"
              defaultValue={item.rubric ?? ""}
              disabled={!editable}
            />
          </div>
          <div>
            <label className="label">Формат</label>
            <select
              name="format"
              className="input"
              defaultValue={item.format}
              disabled={!editable}
            >
              {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Цель</label>
            <select
              name="goal"
              className="input"
              defaultValue={item.goal ?? ""}
              disabled={!editable}
            >
              <option value="">—</option>
              {Object.entries(GOAL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Тема / бриф</label>
          <textarea
            name="topic"
            className="input"
            rows={2}
            defaultValue={item.topic ?? ""}
            disabled={!editable}
          />
        </div>
        <div>
          <label className="label">Базовый текст</label>
          <textarea
            name="base_text"
            className="input"
            rows={4}
            defaultValue={item.base_text ?? ""}
            disabled={!editable}
          />
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary">Сохранить</button>
          </div>
        )}
      </form>

      {editable && (
        <form action={generateAction} className="mt-4">
          <input type="hidden" name="content_item_id" value={item.id} />
          <button className="btn-secondary">
            ✨ Сгенерировать адаптации под каналы (AI)
          </button>
        </form>
      )}

      <AttachedMedia
        ws={ws}
        contentItemId={item.id}
        attached={attachedAssets.map(toMediaAsset)}
        available={availableAssets.map(toMediaAsset)}
        editable={editable}
      />

      <h2 className="mt-8 mb-3 text-lg font-semibold">Адаптации по каналам</h2>
      <div className="space-y-4">
        {[...latestByChannel.values()].map((v) => {
          const channel = v.channel_id ? channelById.get(v.channel_id) : null;
          return (
            <div key={v.id} className="card">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {channel
                    ? `${PLATFORM_LABELS[channel.platform]} · ${channel.name}`
                    : "Базовый вариант"}
                </p>
                <span className="badge bg-zinc-100 text-zinc-600">
                  v{v.version_no}
                </span>
                <ContentStatusBadge status={v.status} />
              </div>

              <form action={saveVariantAction} className="space-y-3">
                <input type="hidden" name="variant_id" value={v.id} />
                <input type="hidden" name="content_item_id" value={item.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="label">Заголовок</label>
                    <input
                      name="title"
                      className="input"
                      defaultValue={v.title ?? ""}
                      disabled={!editable}
                    />
                  </div>
                  <div>
                    <label className="label">Хук</label>
                    <input
                      name="hook"
                      className="input"
                      defaultValue={v.hook ?? ""}
                      disabled={!editable}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Текст</label>
                  <textarea
                    name="body"
                    className="input"
                    rows={5}
                    defaultValue={v.body ?? ""}
                    disabled={!editable}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="label">CTA</label>
                    <input
                      name="cta"
                      className="input"
                      defaultValue={v.cta ?? ""}
                      disabled={!editable}
                    />
                  </div>
                  <div>
                    <label className="label">Хэштеги</label>
                    <input
                      name="hashtags"
                      className="input"
                      defaultValue={v.hashtags.map((h) => `#${h}`).join(" ")}
                      disabled={!editable}
                    />
                  </div>
                </div>
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary">
                      {["approved", "awaiting_approval"].includes(v.status)
                        ? "Сохранить как новую версию"
                        : "Сохранить"}
                    </button>
                  </div>
                )}
              </form>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                {editable &&
                  !["approved", "awaiting_approval", "published"].includes(
                    v.status
                  ) && (
                    <form action={approvalAction}>
                      <input type="hidden" name="variant_id" value={v.id} />
                      <button className="btn-secondary">
                        Отправить на согласование
                      </button>
                    </form>
                  )}
                {v.status === "approved" && channel && (
                  <SchedulePublicationForm
                    ws={ws}
                    variantId={v.id}
                    channelId={channel.id}
                    channelName={`${PLATFORM_LABELS[channel.platform]} · ${channel.name}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {latestByChannel.size === 0 && (
        <p className="text-sm text-zinc-500">
          Адаптаций пока нет. Сгенерируйте их AI или добавьте вручную ниже.
        </p>
      )}

      {editable && (channels?.length ?? 0) > 0 && (
        <form action={saveVariantAction} className="card mt-4 space-y-3">
          <input type="hidden" name="content_item_id" value={item.id} />
          <p className="font-medium">Добавить адаптацию вручную</p>
          <div>
            <label className="label">Канал</label>
            <select name="channel_id" className="input">
              {(channels as Channel[]).map((c) => (
                <option key={c.id} value={c.id}>
                  {PLATFORM_LABELS[c.platform]} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Текст</label>
            <textarea name="body" className="input" rows={4} />
          </div>
          <button className="btn-secondary">Добавить вариант</button>
        </form>
      )}
    </div>
  );
}
