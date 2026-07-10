import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspaces(slug)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const slug = (memberships?.[0]?.workspaces as { slug?: string } | null)?.slug;
  if (!slug) redirect("/onboarding");

  redirect(`/w/${slug}/dashboard`);
}
