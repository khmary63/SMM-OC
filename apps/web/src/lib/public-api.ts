import "server-only";

import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export class PublicApiError extends Error {
  constructor(
    message: string,
    public status: number = 400
  ) {
    super(message);
  }
}

export interface PublicApiContext {
  workspaceId: string;
  apiKeyId: string;
  admin: SupabaseClient;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Генерирует ключ вида maria_xxxxxxxx... Показывается пользователю один раз. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `maria_${randomBytes(24).toString("hex")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

/** Аутентификация запроса публичного API по заголовку Authorization: Bearer. */
export async function requirePublicApi(
  request: Request
): Promise<PublicApiContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(maria_[a-f0-9]{48})$/i);
  if (!match) {
    throw new PublicApiError(
      "Передайте API-ключ в заголовке Authorization: Bearer maria_...",
      401
    );
  }

  const admin = createAdminClient();
  const { data: apiKey } = await admin
    .from("api_keys")
    .select("id, workspace_id, revoked_at")
    .eq("key_hash", hashApiKey(match[1]))
    .maybeSingle();

  if (!apiKey || apiKey.revoked_at) {
    throw new PublicApiError("Недействительный или отозванный API-ключ", 401);
  }

  // best-effort отметка использования
  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});

  return { workspaceId: apiKey.workspace_id, apiKeyId: apiKey.id, admin };
}

export function publicApiHandler<T>(
  fn: (ctx: PublicApiContext, body: T, request: Request) => Promise<unknown>
) {
  return async (request: Request) => {
    try {
      const ctx = await requirePublicApi(request);
      let body = {} as T;
      if (request.method !== "GET" && request.method !== "DELETE") {
        try {
          body = (await request.json()) as T;
        } catch {
          // пустое тело допустимо
        }
      }
      const result = await fn(ctx, body, request);
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof PublicApiError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        );
      }
      const message = err instanceof Error ? err.message : "Внутренняя ошибка";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}
