import { REMINDER_HOUR_MSK, dayBefore, spotName } from "../../coffeerun/run";
import { dynamicsLines } from "../../team/copy";
import { daysUntilStart, dynamicsFor, fetchArchive, runKeysFrom, type ArchiveRow, type Dynamics } from "../../team/history";
import { defaultRun, mergeRuns, pickRun, type TeamRun } from "../../team/runs";
import { fetchRunSignups, summarizeSignups, type SignupRow } from "../../team/stats";
import { can } from "../access";
import {
  NOT_READY_TEXT,
  runCardScreen,
  runsClarifyScreen,
  runsListScreen,
  runsNoneOnDateScreen,
  runsSectionScreen,
  spotWhere,
  type RunRef,
} from "../copy";
import { cb } from "../callback";
import { fetchRunPlan } from "../data/plans";
import { fetchRunPeople, type RunPeople } from "../data/runs";
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
}

const DEFAULT_DEPS: RunsDeps = { fetchArchive, fetchRunSignups, fetchRunPeople, fetchRunPlan };

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
    const [rows, people, plan] = await Promise.all([
      deps.fetchRunSignups(run),
      deps.fetchRunPeople(run.spot, run.date),
      deps.fetchRunPlan(run.spot, run.date),
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
      // Таблица, список участников и план явки — Промт 6.
      case "table":
      case "people":
      case "plan": {
        const back = spot && date ? cb("run", "card", spot, date) : cb("run", "list");
        return screensOf({ text: NOT_READY_TEXT, buttons: [[{ text: "Назад", data: back }]] });
      }
      default:
        return { kind: "stale" };
    }
  };
}

function screensOf(...screens: Screen[]): SectionOutcome {
  return { kind: "screens", screens };
}

export const handleRuns: SectionHandler = createRunsHandler();
