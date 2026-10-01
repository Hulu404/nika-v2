import { createServiceRoleClient } from "@/lib/supabase-server";
import { getAuthed, unauthorized, badRequest, readJson, serverError } from "@/lib/v2/http";

export const runtime = "nodejs";

/**
 * Удаление аккаунта по просьбе пользователя. Тело: { confirm: "удалить" }.
 * Удаляется auth.users, каскадом все данные (профиль, дневник, пробежки,
 * диалоги, цикл, согласия, подписки). Платёжные записи остаются без привязки
 * к человеку (миграция 042). Возврат за неиспользованные дни подписки
 * оформляется письмом на ceo@mynika.ru, интерфейс предупреждает об этом заранее.
 */
export async function DELETE(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  const confirm = typeof body?.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
  if (confirm !== "удалить") return badRequest("confirm");

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(authed.user.id);
  if (error) return serverError("account.delete", error);
  try {
    await authed.supabase.auth.signOut();
  } catch {
    // пользователя уже нет, cookie всё равно сбрасываем ниже
  }
  return Response.json({ ok: true });
}
