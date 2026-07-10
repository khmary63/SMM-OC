import { ApiError, apiHandler } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/workspace";

export const POST = apiHandler<{ name?: string; timezone?: string }>(
  async (body) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ApiError("Не авторизован", 401);

    const name = body.name?.trim();
    if (!name) throw new ApiError("name обязателен");

    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        name,
        slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        owner_user_id: user.id,
        timezone: body.timezone ?? "Europe/Moscow",
      })
      .select("id, slug, name")
      .single();
    if (error) throw new ApiError(error.message);
    return data;
  }
);
