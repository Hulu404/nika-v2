import { COFFEE_RUNS, type CoffeeRun } from "../coffeerun/run";
import { mskMidnight } from "../databot/dates";
import { addDays } from "../databot/time";
import { dailyDigestText, type DigestItem } from "./digest-copy";
import type { TeamEventStore } from "./events";
import type { RunKey } from "./runs";
import { summarizeSignups, type SignupRow } from "./stats";

export interface DigestDeps {
  events: Pick<TeamEventStore, "listBetween">;
  fetchSignups: (run: RunKey) => Promise<SignupRow[]>;
  runs?: readonly CoffeeRun[];
}

/** Сводка дня: все события расписания плюс кофе-раны. null — на день ничего нет. */
export async function buildDailyDigest(deps: DigestDeps, ymd: string, now: Date): Promise<string | null> {
  const events = await deps.events.listBetween(mskMidnight(ymd), mskMidnight(addDays(ymd, 1)));
  const runs = (deps.runs ?? COFFEE_RUNS).filter((r) => r.date === ymd);
  if (!events.length && !runs.length) return null;
  const items: DigestItem[] = events.map((event) => ({ kind: "event" as const, event }));
  for (const run of runs) {
    items.push({ kind: "run", run, stats: summarizeSignups(await deps.fetchSignups({ spot: run.spot, date: run.date }), now) });
  }
  return dailyDigestText(ymd, items, now);
}
