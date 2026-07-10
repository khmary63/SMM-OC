import { requireWorkspace, canEditContent } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import type { Asset, Brand } from "@/lib/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import { UploadForm } from "./upload-form";

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const [{ data: assets }, { data: brands }] = await Promise.all([
    supabase
      .from("assets")
      .select("*, brands(name)")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
  ]);

  // Signed URLs для превью изображений (bucket приватный)
  const imageAssets = ((assets ?? []) as Asset[]).filter((a) =>
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

  return (
    <div>
      <PageHeader
        title="Медиатека"
        subtitle="Исходники и готовые медиафайлы. Хранятся в приватном bucket Supabase Storage."
      />

      {canEditContent(ctx.role) && (
        <UploadForm
          workspaceId={ctx.workspace.id}
          brands={((brands ?? []) as Pick<Brand, "id" | "name">[]).map((b) => ({
            id: b.id,
            name: b.name,
          }))}
        />
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {((assets ?? []) as (Asset & { brands: { name: string } | null })[]).map(
          (a) => (
            <div key={a.id} className="card overflow-hidden p-0">
              <div className="flex h-32 items-center justify-center bg-zinc-100 text-3xl">
                {signedUrls.has(a.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signedUrls.get(a.id)}
                    alt={a.file_name}
                    className="h-full w-full object-cover"
                  />
                ) : a.type === "video" ? (
                  "🎬"
                ) : a.type === "document" ? (
                  "📄"
                ) : (
                  "📦"
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium" title={a.file_name}>
                  {a.file_name}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {a.brands?.name ?? "Без бренда"} · {formatBytes(a.size_bytes)}
                </p>
                <p className="text-xs text-zinc-400">
                  {formatDateTime(a.created_at)}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      {(!assets || assets.length === 0) && (
        <div className="mt-6">
          <EmptyState
            title="Медиатека пуста"
            description="Загрузите изображения и видео, чтобы прикреплять их к публикациям."
          />
        </div>
      )}
    </div>
  );
}
