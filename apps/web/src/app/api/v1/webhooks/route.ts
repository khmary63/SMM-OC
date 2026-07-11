import { randomBytes } from "crypto";
import { PublicApiError, publicApiHandler } from "@/lib/public-api";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

/** GET /api/v1/webhooks — список endpoint'ов (секреты не возвращаются). */
export const GET = publicApiHandler(async (ctx) => {
  const { data, error } = await ctx.admin
    .from("webhook_endpoints")
    .select("id, url, events, is_active, description, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return { webhooks: data, available_events: WEBHOOK_EVENTS };
});

/** POST /api/v1/webhooks — создать endpoint. Секрет возвращается один раз. */
export const POST = publicApiHandler<{
  url?: string;
  events?: string[];
  description?: string;
}>(async (ctx, body) => {
  if (!body.url || !/^https?:\/\//.test(body.url)) {
    throw new PublicApiError("url обязателен и должен начинаться с http(s)://");
  }
  const events = (body.events ?? []).filter((e) =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e)
  );

  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  const { data, error } = await ctx.admin
    .from("webhook_endpoints")
    .insert({
      workspace_id: ctx.workspaceId,
      url: body.url,
      secret,
      events, // пустой массив = все события
      description: body.description ?? null,
    })
    .select("id, url, events, is_active, created_at")
    .single();
  if (error) throw new Error(error.message);

  return {
    webhook: data,
    secret,
    note: "Сохраните secret — он показывается только один раз. Подпись: X-Maria-Signature = HMAC-SHA256(body, secret).",
  };
});

/** DELETE /api/v1/webhooks?id=... — удалить endpoint. */
export const DELETE = publicApiHandler(async (ctx, _body, request) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw new PublicApiError("Параметр id обязателен");

  const { error } = await ctx.admin
    .from("webhook_endpoints")
    .delete()
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);
  if (error) throw new Error(error.message);
  return { ok: true };
});
