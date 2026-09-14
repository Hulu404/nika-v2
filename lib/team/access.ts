import { tgAdmin } from "../telegram/supabase";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";

/**
 * Кто допущен к внутреннему боту команды.
 *
 * Состав живёт в базе (team_members, миграция 035), а не в памяти процесса — и
 * это главное отличие от /admin в основном боте. Тот список обнуляется на
 * каждом деплое: после релиза организатор идёт в панель хостинга за ключом и
 * вводит его заново. Для разового опроса про дождь это терпимо, для
 * инструмента, в который команда заглядывает утром в день забега, — нет.
 *
 * Вход разовый: /join <ключ> (TEAM_BOT_SECRET). Дальше доступ висит на chat_id
 * и переживает и релиз, и смену ника в Telegram.
 *
 * Первый вошедший становится owner. Иначе некому было бы убрать случайного
 * человека — ключ мог утечь в переписке, а править состав через SQL в панели
 * Supabase посреди забега никто не будет.
 */

export type TeamRole = "owner" | "member";

export interface TeamMember {
  chat_id: number;
  username: string | null;
  display_name: string | null;
  role: TeamRole;
  joined_at: string;
  added_by: number | null;
  last_seen_at: string | null;
  /** Слать ли автоматические сводки. Выключается командой /mute. */
  digest_opt_in: boolean;
}

const TABLE = "team_members";
const COLUMNS =
  "chat_id, username, display_name, role, joined_at, added_by, last_seen_at, digest_opt_in";

/** Ключ входа. Пустой — в команду не пустим никого (и так и скажем). */
export function teamSecret(): string {
  // trim с обеих сторон: значение из панели хостинга копируется с хвостовым
  // пробелом или переводом строки чаще, чем кажется, и тогда совпадения не
  // будет никогда — а выглядит это как «бот меня не пускает». Та же защита
  // стоит на ADMIN_SECRET в coffeerun-poll.ts.
  return (process.env.TEAM_BOT_SECRET ?? "").trim();
}

/**
 * Сравнение ключа за постоянное время: перебирать его по времени ответа здесь
 * нечего. Дешевле написать пять строк, чем однажды объяснять, почему в бот с
 * контактами участников пускали по таймингу.
 */
function secretMatches(entered: string, expected: string): boolean {
  if (entered.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < entered.length; i++) {
    diff |= entered.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Член команды по чату, или null. Единственная проверка доступа в боте. */
export async function findMember(chatId: number): Promise<TeamMember | null> {
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) {
    console.error("[team-access] findMember:", error.message);
    return null;
  }
  return (data as TeamMember | null) ?? null;
}

/**
 * Отметить, что человек только что пользовался ботом. Ошибку глотаем в лог:
 * это метка для /team, а не условие ответа — из-за неё команда не должна
 * остаться без цифр в 9:29 на старте.
 */
export async function touchMember(chatId: number): Promise<void> {
  const { error } = await tgAdmin()
    .from(TABLE)
    .update({ last_seen_at: new Date().toISOString() })
    .eq("chat_id", chatId);
  if (error) console.error("[team-access] touchMember:", error.message);
}

export type JoinResult =
  | { status: "joined"; member: TeamMember; first: boolean }
  | { status: "already"; member: TeamMember }
  | { status: "wrong_secret" }
  | { status: "no_secret" }
  | { status: "failed" };

/**
 * /join <ключ>: впустить чат в команду.
 *
 * Идемпотентно: повторный вход уже впущенного обновляет ник и имя (человек мог
 * их сменить) и НЕ трогает роль — иначе owner, заново набравший /join, тихо
 * разжаловал бы сам себя и остался бы без права убирать людей.
 */
export async function joinTeam(
  chatId: number,
  entered: string,
  profile: { username?: string | null; displayName?: string | null },
): Promise<JoinResult> {
  const expected = teamSecret();
  if (!expected) return { status: "no_secret" };

  const existing = await findMember(chatId);
  // Своего не переспрашиваем про ключ: он уже внутри, и повторный /join для
  // него значит «обнови мой ник», а не попытку войти.
  if (existing) {
    const { error } = await tgAdmin()
      .from(TABLE)
      .update({
        username: normalizeTelegramUsername(profile.username) ?? existing.username,
        display_name: profile.displayName ?? existing.display_name,
      })
      .eq("chat_id", chatId);
    if (error) console.error("[team-access] refresh profile:", error.message);
    return { status: "already", member: existing };
  }

  if (!secretMatches(entered, expected)) return { status: "wrong_secret" };

  const first = (await countMembers()) === 0;
  const role: TeamRole = first ? "owner" : "member";

  const { data, error } = await tgAdmin()
    .from(TABLE)
    .insert({
      chat_id: chatId,
      username: normalizeTelegramUsername(profile.username),
      display_name: profile.displayName ?? null,
      role,
      joined_at: new Date().toISOString(),
      added_by: null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    console.error("[team-access] joinTeam:", error.message);
    return { status: "failed" };
  }
  return { status: "joined", member: data as TeamMember, first };
}

/** Сколько человек в команде. Нужно ровно для «первый становится owner». */
async function countMembers(): Promise<number> {
  const { count, error } = await tgAdmin()
    .from(TABLE)
    .select("chat_id", { count: "exact", head: true });
  if (error) {
    console.error("[team-access] countMembers:", error.message);
    // Не знаем — считаем, что кто-то уже есть: лишний owner опаснее лишнего
    // member'а, а починить роль в базе проще, чем отобрать права.
    return 1;
  }
  return count ?? 0;
}

/** Состав команды: owner'ы первыми, дальше по дате входа. */
export async function listTeam(): Promise<TeamMember[]> {
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .order("role", { ascending: true }) // owner < member по алфавиту
    .order("joined_at", { ascending: true });
  if (error) {
    console.error("[team-access] listTeam:", error.message);
    return [];
  }
  return (data ?? []) as TeamMember[];
}

export type RemoveResult =
  | { status: "removed"; member: TeamMember }
  | { status: "not_found" }
  | { status: "last_owner" };

/**
 * Убрать человека из команды. Ищем и по нику, и по chat_id: ник привычнее, но
 * человек мог его сменить или не иметь вовсе.
 *
 * Последнего owner'а убрать нельзя. Не из вежливости: без owner'а состав
 * правится только руками в SQL, а это ровно тот случай, когда правку отложат
 * «на потом» и бот останется с чужим человеком внутри.
 */
export async function removeMember(target: string): Promise<RemoveResult> {
  const member = await findByUsernameOrId(target);
  if (!member) return { status: "not_found" };

  if (member.role === "owner") {
    const owners = (await listTeam()).filter((m) => m.role === "owner");
    if (owners.length <= 1) return { status: "last_owner" };
  }

  const { error } = await tgAdmin().from(TABLE).delete().eq("chat_id", member.chat_id);
  if (error) {
    console.error("[team-access] removeMember:", error.message);
    return { status: "not_found" };
  }
  return { status: "removed", member };
}

/** «@nick», «nick» или «123456789» → член команды. */
export async function findByUsernameOrId(target: string): Promise<TeamMember | null> {
  const raw = target.trim();
  if (!raw) return null;

  // Число — это chat_id. Проверяем первым: ник по правилам Telegram не может
  // начинаться с цифры, так что перепутать нечего.
  if (/^-?\d+$/.test(raw)) return findMember(Number(raw));

  const username = normalizeTelegramUsername(raw);
  if (!username) return null;

  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("username", username)
    .maybeSingle();
  if (error) {
    console.error("[team-access] findByUsernameOrId:", error.message);
    return null;
  }
  return (data as TeamMember | null) ?? null;
}

/**
 * Включить или выключить автоматические сводки для одного чата (/mute,
 * /unmute). Членство это не меняет: «не пиши мне в семь утра» и «не пускай
 * меня к цифрам» — разные просьбы, и первая не должна означать вторую.
 */
export async function setDigestOptIn(chatId: number, optIn: boolean): Promise<boolean> {
  const { error } = await tgAdmin()
    .from(TABLE)
    .update({ digest_opt_in: optIn })
    .eq("chat_id", chatId);
  if (error) {
    console.error("[team-access] setDigestOptIn:", error.message);
    return false;
  }
  return true;
}
