import { tgAdmin } from "../telegram/supabase";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import { dailyDigestDue } from "./digest-schedule";
import { buildCoffeeBlock, type DigestDeps } from "./digest-build";
import { sendTeamMessage, type TeamSendResult } from "./send";
import { isFounder, teamBotConfigured } from "./config";
import { morningPlanText, myDayProjectBlock, type MyDayDeps } from "./my-day";
import { DEFAULT_PROJECTS, hasModule, projectLabel, supabaseProjectStore, type Project } from "./projects/projects";
import { projectIdsOf } from "./projects/labels";
import { supabaseParticipantStore } from "./ai/stores";
import { teamAiConfig } from "./ai/yandex";
import { createSupabaseStore } from "../databot/data/supabase-store";
import { scopedEvents, supabaseEventStore, type TeamEventStore } from "./events";
import { fetchRunSignups } from "./stats";
import { dispatchAttendanceAsks, supabaseFactStore, type FactStore } from "./attendance";
import { supabaseTeamForms, type TeamFormStore } from "./form";
import type { InlineKeyboardMarkup } from "grammy/types";

/**
 * Что «Пятница» присылает сама:
 *   • «Мой день» в 8:00 МСК каждому, кто не выключил сводку через /mute:
 *     события дня, встречи, где он участник, и его задачи на сегодня
 *     (lib/team/my-day.ts); фаундерам — ещё блоки про кофе-ран;
 *   • вопрос о явке через 3 часа после начала ивента клуба — ответственному
 *     или фаундерам, один раз.
 *
 * Зовёт 15-минутный тикер из instrumentation.ts. Дедуп в базе (team_digests с
 * ключом по дате, team_event_asks), а не в памяти: тикер делает первый проход
 * на каждом деплое, и релиз в 8:15 прислал бы сводку второй раз.
 *
 * Чего рассылка принципиально не умеет: сообщить, что умер процесс, в котором
 * она сама живёт. Для «лежит всё» нужен внешний пинг, и это не задача бота.
 */

const THROTTLE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TeamDigestResult {
  ok: true;
  skipped?: string;
  /** Что ушло в этот проход: «daily 2026-10-13», «attend event:5». */
  sent?: string[];
  recipients?: number;
  msk: { date: string; hour: number };
}

export interface DigestDispatchDeps extends DigestDeps, Pick<MyDayDeps, "participants" | "tasks"> {
  events: TeamEventStore;
  /** Голос и текст включены — в конце «Напиши или надиктуй…». */
  aiEnabled?: boolean;
  facts: FactStore;
  forms: TeamFormStore;
  /** Кому идут сводки: команда минус /mute. */
  recipients: () => Promise<number[]>;
  /** Занять сводку дня под отправку. false — уже отправляли. */
  claimDaily: (ymd: string) => Promise<boolean>;
  markDailySent: (ymd: string, count: number) => Promise<void>;
  send: (chatId: number, text: string, keyboard?: InlineKeyboardMarkup) => Promise<TeamSendResult>;
  throttleMs?: number;
  /** Проекты человека (по умолчанию — только nika). */
  projectsOf?: (chatId: number) => Promise<Project[]>;
  /** События проекта (по умолчанию — events, это nika). */
  eventsFor?: (projectId: string) => Pick<TeamEventStore, "listBetween">;
}

/** Кому план на день: все без /mute; блоки — по их проектам. */
async function recipients(): Promise<number[]> {
  const { data, error } = await tgAdmin().from("team_members").select("chat_id").eq("digest_opt_in", true);
  if (error) {
    console.error("[team-digest] recipients:", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ chat_id: number }>).map((r) => r.chat_id);
}

/** Проекты человека из базы (фаундер — все). */
async function projectsOfPerson(chatId: number): Promise<Project[]> {
  const [all, ids] = await Promise.all([supabaseProjectStore().list(), projectIdsOf(chatId)]);
  return all.filter((p) => ids.includes(p.id));
}

/**
 * Вставка с primary key (kind, spot, run_date) — она же проверка «не
 * отправляли»: две параллельные попытки не разойдутся, вторая получит 23505.
 * Сводка дня занимает ключ ('daily', 'all', дата).
 */
async function claimDaily(ymd: string): Promise<boolean> {
  const { error } = await tgAdmin().from("team_digests").insert({ kind: "daily", spot: "all", run_date: ymd, sent_to: 0 });
  if (!error) return true;
  if (error.code !== "23505") console.error("[team-digest] claim:", error.message);
  return false;
}

async function markDailySent(ymd: string, count: number): Promise<void> {
  const { error } = await tgAdmin().from("team_digests")
    .update({ sent_to: count, sent_at: new Date().toISOString() })
    .eq("kind", "daily").eq("spot", "all").eq("run_date", ymd);
  if (error) console.error("[team-digest] markSent:", error.message);
}

function defaultDeps(): DigestDispatchDeps {
  return {
    events: supabaseEventStore(),
    fetchSignups: fetchRunSignups,
    facts: supabaseFactStore(),
    forms: supabaseTeamForms(),
    participants: supabaseParticipantStore(),
    tasks: createSupabaseStore(),
    aiEnabled: !!teamAiConfig(),
    projectsOf: projectsOfPerson,
    eventsFor: (projectId) => scopedEvents(supabaseEventStore(), projectId),
    recipients,
    claimDaily,
    markDailySent,
    send: (chatId, text, keyboard) => sendTeamMessage(chatId, text, { html: true, keyboard }),
  };
}

export interface DispatchOptions {
  /** Только посчитать и построить тексты, ничего не отправляя и не помечая. */
  dryRun?: boolean;
  now?: Date;
  deps?: DigestDispatchDeps;
}

export async function dispatchTeamDigests(opts: DispatchOptions = {}): Promise<TeamDigestResult> {
  const now = opts.now ?? new Date();
  const { ymd, hour } = localParts(DEFAULT_TZ, now);
  const msk = { date: ymd, hour };
  if (!opts.deps && !teamBotConfigured()) return { ok: true, skipped: "TEAM_BOT_TOKEN не задан", msk };
  const deps = opts.deps ?? defaultDeps();
  const sent: string[] = [];
  let to: number[] = [];

  const day = dailyDigestDue(ymd, hour);
  if (day && opts.dryRun) sent.push(`daily ${day}`);
  else if (day && (await deps.claimDaily(day))) {
    // Каждому своё сообщение, даже пустое: «На сегодня ничего не запланировано».
    let coffee: string[] = [];
    try {
      coffee = await buildCoffeeBlock(deps, day, now);
    } catch (err) {
      console.error("[team-digest] coffee block:", err instanceof Error ? err.message : String(err));
    }
    to = await deps.recipients();
    let delivered = 0;
    for (const chatId of to) {
      try {
        // Одно сообщение на человека: блоки его проектов, пустой день — не отправляем.
        const projects = deps.projectsOf ? await deps.projectsOf(chatId) : DEFAULT_PROJECTS.slice(0, 1);
        const blocks = [];
        for (const p of projects) {
          const events = deps.eventsFor ? deps.eventsFor(p.id) : deps.events;
          const extra = isFounder(chatId) && hasModule(p, "coffee_run") ? coffee : [];
          blocks.push({ label: projectLabel(p), lines: await myDayProjectBlock({ events, participants: deps.participants, tasks: deps.tasks, projectId: p.id }, chatId, now, extra) });
        }
        const text = morningPlanText(day, blocks, !!deps.aiEnabled);
        if (!text) continue;
        if ((await deps.send(chatId, text)).ok) delivered++;
      } catch (err) {
        console.error("[team-digest] my day:", chatId, err instanceof Error ? err.message : String(err));
      }
      if (deps.throttleMs ?? THROTTLE_MS) await sleep(deps.throttleMs ?? THROTTLE_MS);
    }
    await deps.markDailySent(day, delivered);
    sent.push(`daily ${day}`);
  }

  if (!opts.dryRun) {
    try {
      for (const key of await dispatchAttendanceAsks(deps, now)) sent.push(`attend ${key}`);
    } catch (err) {
      console.error("[team-digest] attendance asks:", err instanceof Error ? err.message : String(err));
    }
  }

  if (!sent.length) return { ok: true, skipped: "нечего слать", msk };
  return { ok: true, sent, recipients: to.length, msk };
}
