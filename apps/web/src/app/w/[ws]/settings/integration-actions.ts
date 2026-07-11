"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, canAdmin } from "@/lib/workspace";
import { generateApiKey } from "@/lib/public-api";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

export interface SecretResult {
  ok: boolean;
  secret?: string;
  error?: string;
}

/** Создать API-ключ. Ключ возвращается ОДИН раз. */
export async function createApiKeyAction(
  ws: string,
  _prev: SecretResult | null,
  formData: FormData
): Promise<SecretResult> {
  try {
    const ctx = await requireWorkspace(ws);
    if (!canAdmin(ctx.role)) return { ok: false, error: "Недостаточно прав" };

    const name = String(formData.get("name") ?? "").trim() || "API key";
    const { key, prefix, hash } = generateApiKey();

    const supabase = await createClient();
    const { error } = await supabase.from("api_keys").insert({
      workspace_id: ctx.workspace.id,
      name,
      key_prefix: prefix,
      key_hash: hash,
      created_by: ctx.userId,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/w/${ws}/settings`);
    return { ok: true, secret: key };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка",
    };
  }
}

export async function revokeApiKeyAction(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", String(formData.get("key_id")))
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/settings`);
}

/** Создать webhook endpoint. Секрет подписи возвращается ОДИН раз. */
export async function createWebhookAction(
  ws: string,
  _prev: SecretResult | null,
  formData: FormData
): Promise<SecretResult> {
  try {
    const ctx = await requireWorkspace(ws);
    if (!canAdmin(ctx.role)) return { ok: false, error: "Недостаточно прав" };

    const url = String(formData.get("url") ?? "").trim();
    if (!/^https?:\/\//.test(url)) {
      return { ok: false, error: "URL должен начинаться с http(s)://" };
    }

    const events = (WEBHOOK_EVENTS as readonly string[]).filter(
      (e) => formData.get(`event:${e}`) === "on"
    );

    const secret = `whsec_${randomBytes(24).toString("hex")}`;

    const supabase = await createClient();
    const { error } = await supabase.from("webhook_endpoints").insert({
      workspace_id: ctx.workspace.id,
      url,
      secret,
      events, // пусто = все события
      description: String(formData.get("description") ?? "") || null,
      created_by: ctx.userId,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/w/${ws}/settings`);
    return { ok: true, secret };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка",
    };
  }
}

export async function deleteWebhookAction(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("id", String(formData.get("endpoint_id")))
    .eq("workspace_id", ctx.workspace.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/settings`);
}
