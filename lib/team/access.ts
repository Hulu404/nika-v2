import { tgAdmin } from "../telegram/supabase";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { isFounder } from "./config";
import { PROJECT_ROSTER, normUsername, rosterPatch, type ProfilePatch } from "./roster";
import { projectTeam, supabaseMembershipStore, type MembershipStore } from "./projects/members";
import { NIKA, supabaseProjectStore, type Project } from "./projects/projects";

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
  /** Отделы (lib/team/departments.ts); до миграции 051 поля нет. */
  departments?: string[];
  /** Имя, должность, варианты имени (миграция 053; начальные — roster.ts). */
  first_name?: string | null;
  title?: string | null;
  name_aliases?: string[];
  /** Когда профиль меняли в боте: roster.ts его больше не трогает. */
  profile_edited_at?: string | null;
  /** Какой проект человек сейчас смотрит (миграция 058). */
  current_project?: string | null;
}

const TABLE = "team_members";
// Все колонки: departments появится в базе только после миграции 051, и явный
// список уронил бы вход в бот до её применения.
const COLUMNS = "*";

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
  // Ключ /join — вход в nika (другие проекты — по приглашению).
  await supabaseMembershipStore().add({ project_id: NIKA, chat_id: chatId }, new Date()).catch((e) => console.error("[team-access] join nika:", e instanceof Error ? e.message : e));
  return { status: "joined", member: data as TeamMember };
}

/**
 * Команда проекта: люди из реестра с должностью и отделами из проекта; фаундеры
 * видны везде. До миграции 058 — прежний состав (все — nika).
 */
export async function listProjectTeam(projectId: string, memberships: MembershipStore = supabaseMembershipStore()): Promise<TeamMember[]> {
  const [people, members] = await Promise.all([listTeam(), memberships.ofProject(projectId).catch(() => [])]);
  return projectTeam(people, members);
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

/** Включить или выключить человеку отдел. Возвращает новый список; null — человека нет. */
export async function toggleDepartment(chatId: number, department: string): Promise<string[] | null> {
  const member = await findMember(chatId);
  if (!member) return null;
  const current = member.departments ?? [];
  const next = current.includes(department) ? current.filter((d) => d !== department) : [...current, department];
  await updateProfile(chatId, { departments: next });
  return next;
}

/** Отметить, что профиль меняли в боте: roster.ts его больше не трогает. */
export async function markProfileEdited(chatId: number, now: Date = new Date()): Promise<void> {
  const { error } = await tgAdmin().from(TABLE).update({ profile_edited_at: now.toISOString() }).eq("chat_id", chatId);
  if (error) console.error("[team-access] markProfileEdited:", error.message);
}

/** Правка профиля в боте (имя, должность, отделы, варианты имени). После неё roster.ts профиль не трогает. */
export async function updateProfile(chatId: number, patch: ProfilePatch, now: Date = new Date()): Promise<void> {
  const { error } = await tgAdmin().from(TABLE).update({ ...patch, profile_edited_at: now.toISOString() }).eq("chat_id", chatId);
  if (error) throw new Error(`team_members: ${error.message}`);
}

/**
 * Дописать человеку пустые поля из roster.ts (при /join и /start): имя и
 * варианты имени — в реестр, должность и отделы — в проекты из PROJECT_ROSTER.
 * Фаундеры — админы во всех проектах. До миграций 053/058 — молча ничего.
 * true — что-то дописали.
 */
export async function applyRoster(member: TeamMember, memberships: MembershipStore = supabaseMembershipStore(), projects?: Project[]): Promise<boolean> {
  let changed = false;
  const patch = rosterPatch(member);
  if (patch) {
    const { error } = await tgAdmin().from(TABLE).update(patch).eq("chat_id", member.chat_id).is("profile_edited_at", null);
    if (error) console.error("[team-access] applyRoster:", error.message);
    else changed = true;
  }
  try {
    const mine = await memberships.ofPerson(member.chat_id);
    const now = new Date();
    if (isFounder(member.chat_id)) {
      for (const p of projects ?? (await supabaseProjectStore().list())) {
        const row = mine.find((m) => m.project_id === p.id);
        if (!row) changed = (await memberships.add({ project_id: p.id, chat_id: member.chat_id, role: "admin" }, now)) || changed;
        else if (row.role !== "admin") {
          await memberships.update(p.id, member.chat_id, { role: "admin" });
          changed = true;
        }
      }
    }
    for (const [projectId, entries] of Object.entries(PROJECT_ROSTER)) {
      const r = entries.find((e) => normUsername(e.username) === normUsername(member.username));
      if (!r) continue;
      const row = mine.find((m) => m.project_id === projectId);
      if (!row) changed = (await memberships.add({ project_id: projectId, chat_id: member.chat_id, title: r.title, departments: r.departments }, now)) || changed;
      else if (!member.profile_edited_at && (!row.title || !row.departments.length)) {
        await memberships.update(projectId, member.chat_id, { ...(!row.title ? { title: r.title } : {}), ...(!row.departments.length ? { departments: r.departments } : {}) });
        changed = true;
      }
    }
  } catch (err) {
    console.error("[team-access] applyRoster projects:", err instanceof Error ? err.message : String(err));
  }
  return changed;
}

/** Один раз при старте приложения: всем, кто уже в команде. */
export async function applyRosterAll(): Promise<number> {
  let n = 0;
  const memberships = supabaseMembershipStore();
  const projects = await supabaseProjectStore().list();
  for (const m of await listTeam()) if (await applyRoster(m, memberships, projects)) n++;
  return n;
}

/** Переключить текущий проект человека. */
export async function setCurrentProject(chatId: number, projectId: string): Promise<void> {
  const { error } = await tgAdmin().from(TABLE).update({ current_project: projectId }).eq("chat_id", chatId);
  if (error) console.error("[team-access] setCurrentProject:", error.message);
}
