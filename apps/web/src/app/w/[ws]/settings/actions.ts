"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace, canAdmin } from "@/lib/workspace";

export async function updateWorkspace(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      timezone: String(formData.get("timezone") ?? "Europe/Moscow"),
    })
    .eq("id", ctx.workspace.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/settings`);
}

/**
 * Приглашение по email. Если пользователь уже зарегистрирован — добавляем сразу;
 * иначе отправляем invite через Supabase Auth Admin API.
 */
export async function inviteMember(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  if (!email) return;

  const admin = createAdminClient();

  const { data: existingId } = await admin.rpc("find_user_id_by_email", {
    p_email: email,
  });
  let userId = (existingId as string | null) ?? null;

  if (!userId) {
    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.APP_BASE_URL ?? ""}/login`,
      });
    if (inviteError) throw new Error(inviteError.message);
    userId = invited.user.id;
  }

  const { error } = await admin.from("workspace_members").upsert({
    workspace_id: ctx.workspace.id,
    user_id: userId,
    role,
    is_active: true,
    invited_by: ctx.userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/w/${ws}/settings`);
}

export async function updateMemberRole(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const userId = String(formData.get("user_id"));
  const role = String(formData.get("role"));

  const { error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId)
    .neq("role", "owner");
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/settings`);
}

export async function removeMember(ws: string, formData: FormData) {
  const ctx = await requireWorkspace(ws);
  if (!canAdmin(ctx.role)) throw new Error("Недостаточно прав");

  const supabase = await createClient();
  const userId = String(formData.get("user_id"));

  const { error } = await supabase
    .from("workspace_members")
    .update({ is_active: false })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId)
    .neq("role", "owner");
  if (error) throw new Error(error.message);
  revalidatePath(`/w/${ws}/settings`);
}
