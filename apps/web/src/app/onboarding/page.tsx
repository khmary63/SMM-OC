import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/workspace";

async function createWorkspace(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "Europe/Moscow");
  if (!name) return;

  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name, slug, owner_user_id: user.id, timezone })
    .select("slug")
    .single();

  if (error) throw new Error(error.message);
  redirect(`/w/${data.slug}/dashboard`);
}

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold">Создайте рабочее пространство</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Workspace объединяет бренды, каналы и команду. Например — название
            вашего агентства или клиента.
          </p>
        </div>
        <form action={createWorkspace} className="card space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              name="name"
              className="input"
              placeholder="Моё агентство"
              required
            />
          </div>
          <div>
            <label className="label">Часовой пояс</label>
            <select name="timezone" className="input" defaultValue="Europe/Moscow">
              <option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
              <option value="Europe/Moscow">Москва (UTC+3)</option>
              <option value="Europe/Samara">Самара (UTC+4)</option>
              <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
              <option value="Asia/Omsk">Омск (UTC+6)</option>
              <option value="Asia/Novosibirsk">Новосибирск (UTC+7)</option>
              <option value="Asia/Irkutsk">Иркутск (UTC+8)</option>
              <option value="Asia/Yakutsk">Якутск (UTC+9)</option>
              <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
            </select>
          </div>
          <button className="btn-primary w-full">Создать workspace</button>
        </form>
      </div>
    </div>
  );
}
