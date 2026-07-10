import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 400
  ) {
    super(message);
  }
}

export interface ApiContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

/** Аутентификация запроса + проверка членства в workspace. */
export async function requireApiContext(
  workspaceId: string | null | undefined
): Promise<ApiContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError("Не авторизован", 401);
  if (!workspaceId) throw new ApiError("workspace_id обязателен", 400);

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!member) throw new ApiError("Нет доступа к workspace", 403);

  return {
    userId: user.id,
    workspaceId,
    role: member.role as WorkspaceRole,
  };
}

export function apiHandler<T>(
  fn: (body: T, request: Request) => Promise<unknown>
) {
  return async (request: Request) => {
    try {
      let body = {} as T;
      try {
        body = (await request.json()) as T;
      } catch {
        // пустое тело допустимо
      }
      const result = await fn(body, request);
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Внутренняя ошибка";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}
