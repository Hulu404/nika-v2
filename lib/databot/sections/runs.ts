import { REMINDER_HOUR_MSK, dayBefore, spotName } from "../../coffeerun/run";
import { dynamicsLines } from "../../team/copy";
import { supabaseFactStore } from "../../team/attendance";
import { daysUntilStart, dynamicsFor, fetchArchive, runKeysFrom, type ArchiveRow, type Dynamics } from "../../team/history";
import { defaultRun, mergeRuns, pickRun, type TeamRun } from "../../team/runs";
import { fetchRunSignups, summarizeSignups, viewSignups, type SignupRow, type SignupView } from "../../team/stats";
import { can } from "../access";
import {
  PLAN_ASK,
  PLAN_MAX,
  PLAN_MIN,
  PLAN_PAST_TEXT,
  PLAN_RETRY,
  peoplePageScreen,
  planSavedText,
  runCardScreen,
  runsCsv,
  runsCsvFilename,
  runsTableScreen,
  runsClarifyScreen,
  runsListScreen,
  runsNoneOnDateScreen,
  runsSectionScreen,
  spotWhere,
  type RunRef,
} from "../copy";
import { fetchRunPlan, setRunPlan } from "../data/plans";
import {
  fetchRunPeople,
  fetchRunRoster,
  fetchRunsTable,
  type RosterRow,
  type RunPeople,
  type RunsTableRow,
} from "../data/runs";
import { openForm } from "../form";
import { parseRunDate } from "../dates";
import { forecast, forecastText } from "../forecast";
import type { SectionHandler, SectionOutcome, SectionRequest } from "../section";
import { mskHour, mskToday } from "../time";
import type { Screen } from "../types";

/**
 * Раздел «Забеги» (ТЗ 4.4). Забег — пара (спот, дата) из mergeRuns:
 * расписание COFFEE_RUNS плюс заявки в базе. Заявки, статусы и динамика
 * считаются функциями lib/team напрямую — те же вызовы, что у /run
 * командного бота (lib/team/bot.ts), поэтому цифры двух ботов совпадают по
 * определению. Из SQL здесь только то, чего в lib/team нет: новые и повторные,
 * метки и план явки.
 */

/** Чтение данных — подменяется в тестах. По умолчанию — боевые функции. */
export interface RunsDeps {
  fetchArchive: () => Promise<ArchiveRow[]>;
  fetchRunSignups: (run: { spot: string; date: string }) => Promise<SignupRow[]>;
  fetchRunPeople: (spot: string, date: string) => Promise<RunPeople>;
  fetchRunPlan: (spot: string, date: string) => Promise<number | null>;
  fetchRunRoster: (spot: string, date: string) => Promise<RosterRow[]>;
  setRunPlan: (spot: string, date: string, target: number, setBy: number, now: Date) => Promise<void>;
  fetchRunsTable: (fromYmd: string, toYmd: string) => Promise<RunsTableRow[]>;
  /** Фактическая явка из «Пятницы» (team_event_facts); null — не внесена. */
  fetchRunAttended?: (spot: string, date: string) => Promise<number | null>;
}

/** Явку вносит команда в «Пятнице»; здесь только читаем. Сбой чтения карточку не ломает. */
async function fetchRunAttended(spot: string, date: string): Promise<number | null> {
  try {
    const key = `coffeerun:${spot}:${date}`;
    return (await supabaseFactStore().getMany([key])).get(key) ?? null;
  } catch (err) {
    console.error("[databot] run attended:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

const DEFAULT_DEPS: RunsDeps = {
  fetchArchive,
  fetchRunSignups,
  fetchRunPeople,
  fetchRunPlan,
  fetchRunRoster,
  setRunPlan,
  fetchRunsTable,
  fetchRunAttended,
};

/** Таблица «все забеги» — за всю историю: забегов единицы в неделю. */
const TABLE_FROM = "2000-01-01";
const TABLE_TO = "2100-12-31";

/**
 * Статус и порядок строк списка — функциями lib/team (signupStatus и
 * viewSignups), чтобы «⚠️ не подтвердил» значило ровно то же, что в
 * командном боте. Chat_id в выборку не попадает: signupStatus нужен только
 * факт «чат есть», поэтому вместо id передаётся 1.
 */
export function orderRoster(rows: readonly RosterRow[]): Array<SignupView & { isNew: boolean }> {
  const asSignups = rows.map((r) => ({
    name: r.name,
    contact: "",
    pace: r.pace,
    created_at: r.createdAt,
    confirmed_at: r.confirmedAt,
    reminder_sent_at: r.reminderSentAt,
    tg_username: r.nick,
    tg_chat_id: r.tgLinked ? 1 : null,
    isNew: r.isNew,
  }));
  // viewSignups копирует строку ({ ...row, status }), поэтому isNew доезжает.
  return viewSignups(asSignups) as Array<SignupView & { isNew: boolean }>;
}

/** Ближайших забегов кнопками на экране раздела. */
const UPCOMING_BUTTONS = 4;
/** Прошедших кнопками — дальше уже таблица. */
const PAST_BUTTONS = 8;
/**
 * dynamicsFor по умолчанию берёт три прошлых забега ДО фильтра «запись уже
 * шла». Для прогноза нужны три сравнимых ПОСЛЕ фильтра, поэтому для него
 * просим с запасом; строка динамики в карточке — с лимитом по умолчанию, как
 * у /run командного бота.
 */
const FORECAST_LOOKBACK = 50;

function ref(run: TeamRun): RunRef {
  return { spot: run.spot, date: run.date, spotName: run.scheduled?.spotName ?? spotName(run.spot) };
}

/** Ближайшие — от ранних к поздним (mergeRuns сортирует от свежих к старым). */
function upcoming(runs: readonly TeamRun[]): TeamRun[] {
  return runs
    .filter((r) => !r.past)
    .sort((a, b) => a.date.localeCompare(b.date) || a.spot.localeCompare(b.spot));
}

/**
 * Строка динамики формулировками lib/team/copy.ts: «За 3 дня до старта:» и
 * вердикт («на 7 больше, чем обычно (к этому моменту — 16)» или «чем в прошлый
 * сравнимый раз»). Поштучный разбор прошлых забегов — кнопкой «Прошлые забеги
 * этой точки»: в карточке по 4.10 не больше восьми строк подробностей.
 */
export function dynamicsSummary(dyn: Dynamics | null): string | null {
  if (!dyn) return null;
  const lines = dynamicsLines(dyn);
  const head = lines[0];
  const verdict = (lines.at(-1) ?? "").trim().replace(/^→\s*/, "");
  return `${head} сейчас ${dyn.now}, ${verdict}`;
}

/** Окно рассылки напоминаний уже наступило (накануне с 10:00 МСК) или прошло. */
export function reminderWindowOpen(date: string, now: Date): boolean {
  const today = mskToday(now);
  const eve = dayBefore(date);
  if (today > eve) return true;
  return today === eve && mskHour(now) >= REMINDER_HOUR_MSK;
}

export function createRunsHandler(deps: RunsDeps = DEFAULT_DEPS): SectionHandler {
  async function snapshot(now: Date): Promise<{ archive: ArchiveRow[]; runs: TeamRun[] }> {
    // Тот же снимок, что у командного бота: архив заявок и забеги из него
    // плюс расписание (lib/team/bot.ts, snapshot).
    const archive = await deps.fetchArchive();
    return { archive, runs: mergeRuns(runKeysFrom(archive), now) };
  }

  function sectionScreen(runs: readonly TeamRun[]): Screen {
    return runsSectionScreen(upcoming(runs).slice(0, UPCOMING_BUTTONS).map(ref));
  }

  async function card(req: SectionRequest, run: TeamRun, archive: ArchiveRow[]): Promise<Screen> {
    const { now, subject } = req;
    const [rows, people, plan, attended] = await Promise.all([
      deps.fetchRunSignups(run),
      deps.fetchRunPeople(run.spot, run.date),
      deps.fetchRunPlan(run.spot, run.date),
      run.past ? (deps.fetchRunAttended ?? (async () => null))(run.spot, run.date) : Promise.resolve(null),
    ]);
    const stats = summarizeSignups(rows, now);
    if (people.total !== stats.total) {
      // Определения разошлись (дубли, отмены) — карточку не прячем, но шумим:
      // Промт 5 требует, чтобы SQL считал ровно как lib/team.
      console.warn(`[databot] run_people ${people.total} ≠ lib/team ${stats.total}`);
    }

    const daysBefore = run.past ? null : daysUntilStart(run.date, now);
    const dyn = run.past ? null : dynamicsFor(run, archive, now);
    const dynForForecast = run.past ? null : dynamicsFor(run, archive, now, FORECAST_LOOKBACK);
    const name = ref(run).spotName;
    const f = forecast({ daysBefore, current: stats.total, previous: dynForForecast?.previous ?? [] });
    const today = mskToday(now);
    const accessCtx = { runDate: run.date, today };

    return runCardScreen({
      spot: run.spot,
      date: run.date,
      spotName: name,
      past: run.past,
      schedule: run.scheduled
        ? { gatherTime: run.scheduled.gatherTime, startTime: run.scheduled.startTime, address: run.scheduled.address }
        : null,
      total: stats.total,
      confirmed: stats.confirmed,
      reminded: stats.reminded,
      reminderWindowOpen: stats.reminded > 0 || reminderWindowOpen(run.date, now),
      last24h: stats.last24h,
      newPeople: people.newPeople,
      returningPeople: people.returningPeople,
      byPace: stats.byPace,
      byLink: people.byLink,
      plan,
      attended,
      daysBefore,
      dynamics: dynamicsSummary(dyn),
      forecast: forecastText(f, spotWhere(run.spot, name)),
      canPeople: can(subject, "run.people", accessCtx),
      canPlan: can(subject, "run.plan.set", accessCtx),
      at: now,
    });
  }

  /** «/runs 03.10», «/runs лужники», «/runs ближайший» — найти забег по тексту. */
  async function find(req: SectionRequest, query: string): Promise<SectionOutcome> {
    const { archive, runs } = await snapshot(req.now);
    const next = upcoming(runs);
    const dateRef = parseRunDate(query, req.now);

    let candidates: TeamRun[] = [];
    if (dateRef?.kind === "date") {
      candidates = runs.filter((r) => r.date === dateRef.ymd);
      if (candidates.length === 0) {
        return screensOf(runsNoneOnDateScreen(dateRef.ymd, next.slice(0, UPCOMING_BUTTONS).map(ref)));
      }
    } else if (dateRef?.kind === "nearest") {
      const first = next[0];
      candidates = first ? next.filter((r) => r.date === first.date) : [];
    } else if (dateRef?.kind === "previous") {
      const last = runs.find((r) => r.past);
      candidates = last ? runs.filter((r) => r.past && r.date === last.date) : [];
    } else {
      const picked = pickRun(query, runs);
      candidates = picked ? [picked] : [];
    }

    if (candidates.length === 0) {
      const fallback = defaultRun(runs);
      return screensOf(fallback ? await card(req, fallback, archive) : sectionScreen(runs));
    }
    if (candidates.length > 1) return screensOf(runsClarifyScreen(candidates.map(ref)));
    return screensOf(await card(req, candidates[0], archive));
  }

  return async (req) => {
    const { intent, now } = req;
    const { spot, date } = intent.params;

    switch (intent.action) {
      case "list": {
        if (intent.params.q) return find(req, intent.params.q);
        const { runs } = await snapshot(now);
        return screensOf(sectionScreen(runs));
      }
      case "card": {
        const { archive, runs } = await snapshot(now);
        const run = runs.find((r) => r.spot === spot && r.date === date);
        if (!run) return { kind: "stale" };
        return screensOf(await card(req, run, archive));
      }
      case "past": {
        const { runs } = await snapshot(now);
        return screensOf(
          runsListScreen("Прошедшие забеги", runs.filter((r) => r.past).slice(0, PAST_BUTTONS).map(ref), "Прошедших забегов пока нет."),
        );
      }
      case "spot": {
        const { runs } = await snapshot(now);
        const list = runs.filter((r) => r.past && r.spot === spot).slice(0, PAST_BUTTONS).map(ref);
        const title = `Прошлые забеги · ${list[0]?.spotName ?? spotName(spot ?? "")}`;
        return screensOf(runsListScreen(title, list, "У этой точки прошедших забегов пока нет."));
      }
      case "people": {
        // Доступ и окно дат проверил конвейер (access.ts) — до обращения к базе.
        const { runs } = await snapshot(now);
        const run = runs.find((r) => r.spot === spot && r.date === date);
        if (!run) return { kind: "stale" };
        const ordered = orderRoster(await deps.fetchRunRoster(run.spot, run.date));
        const page = Number(intent.params.page ?? "1");
        const out = screensOf(
          peoplePageScreen({
            spot: run.spot,
            date: run.date,
            spotName: ref(run).spotName,
            page,
            rows: ordered.map((v) => ({ status: v.status, name: v.name, nick: v.tg_username, pace: v.pace, isNew: v.isNew })),
          }),
        );
        // «Ещё» — новым защищённым сообщением; кнопку у прошлого снимаем, чтобы
        // второе нажатие не прислало ту же страницу ещё раз.
        return page > 1 ? { ...out, consumeButton: true } : out;
      }
      case "plan": {
        const { runs } = await snapshot(now);
        const run = runs.find((r) => r.spot === spot && r.date === date);
        if (!run) return { kind: "stale" };
        if (run.past) return screensOf({ text: PLAN_PAST_TEXT });
        await req.store.setForm(req.subject.chatId, openForm("run.plan", { spot: run.spot, date: run.date }, now), now);
        return screensOf({ text: PLAN_ASK });
      }
      case "plan_submit": {
        const { archive, runs } = await snapshot(now);
        const run = runs.find((r) => r.spot === spot && r.date === date);
        if (!run || run.past) {
          await req.store.clearSession(req.subject.chatId);
          return screensOf({ text: PLAN_PAST_TEXT });
        }
        const raw = (intent.params.value ?? "").trim();
        const target = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
        // Не число или вне диапазона — просим ещё раз, форма остаётся открытой.
        if (!(target >= PLAN_MIN && target <= PLAN_MAX)) return screensOf({ text: PLAN_RETRY });
        await deps.setRunPlan(run.spot, run.date, target, req.subject.chatId, now);
        await req.store.clearSession(req.subject.chatId);
        return screensOf({ text: planSavedText(target) }, await card(req, run, archive));
      }
      case "table": {
        const rows = await deps.fetchRunsTable(TABLE_FROM, TABLE_TO);
        const page = Number(intent.params.page ?? "1");
        return screensOf(runsTableScreen(tableLines(rows), page, now));
      }
      case "csv": {
        const rows = await deps.fetchRunsTable(TABLE_FROM, TABLE_TO);
        return screensOf({
          text: "Все забеги — только агрегаты, без имён",
          document: { filename: runsCsvFilename(mskToday(now)), content: runsCsv(tableLines(rows)) },
        });
      }
      default:
        return { kind: "stale" };
    }
  };
}

function tableLines(rows: readonly RunsTableRow[]) {
  return rows.map((r) => ({ ...r, spotName: spotName(r.spot) }));
}

function screensOf(...screens: Screen[]): SectionOutcome {
  return { kind: "screens", screens };
}

export const handleRuns: SectionHandler = createRunsHandler();
