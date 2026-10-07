import { tgAdmin } from "../telegram/supabase";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { isFounder } from "./config";

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
 * Права у всех участников равные. Особые права (/kick, правка любого события,
 * исправление явки) только у фаундеров из TEAM_FOUNDER_IDS (config.ts).
 * Столбец role в базе остался от прежней схемы «первый вошедший = владелец» и
 * на права больше не влияет.
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
export async function touchMember(chatId: number, now: Date = new Date()): Promise<void> {
  const { error } = await tgAdmin()
    .from(TABLE)
    .update({ last_seen_at: now.toISOString() })
    .eq("chat_id", chatId);
  if (error) console.error("[team-access] touchMember:", error.message);
}

export type JoinResult =
  | { status: "joined"; member: TeamMember }
  | { status: "already"; member: TeamMember }
  | { status: "wrong_secret" }
  | { status: "no_secret" }
  | { status: "failed" };

/**
 * /join <ключ>: впустить чат в команду.
 *
 * Идемпотентно: повторный вход уже впущенного обновляет ник и имя (человек мог
 * их сменить). Первый вошедший никем особым не становится.
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

  const { data, error } = await tgAdmin()
    .from(TABLE)
    .insert({
      chat_id: chatId,
      username: normalizeTelegramUsername(profile.username),
      display_name: profile.displayName ?? null,
      role: "member",
      joined_at: new Date().toISOString(),
      added_by: null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    console.error("[team-access] joinTeam:", error.message);
    return { status: "failed" };
  }
  return { status: "joined", member: data as TeamMember };
}

/** Состав команды по дате входа. Фаундеров /team отмечает сам (isFounder). */
export async function listTeam(): Promise<TeamMember[]> {
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
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
  | { status: "founder" };

/**
 * Убрать человека из команды. Ищем и по нику, и по chat_id: ник привычнее, но
 * человек мог его сменить или не иметь вовсе.
 *
 * Фаундера через /kick не убрать: его права заданы переменной окружения, и
 * убранный он всё равно остался бы фаундером. Сам выйти (/leave) может.
 */
export async function removeMember(
  target: string,
  opts: { allowFounder?: boolean } = {},
): Promise<RemoveResult> {
  const member = await findByUsernameOrId(target);
  if (!member) return { status: "not_found" };
  if (!opts.allowFounder && isFounder(member.chat_id)) return { status: "founder" };

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
