import { mskMidnight } from "../databot/dates";
import { addDays, mskToday } from "../databot/time";
import { dailyDigestText, type DigestItem } from "./digest-copy";
import { isCoffeeRunEvent, type TeamEventStore } from "./events";
import type { RunKey } from "./runs";
import { summarizeSignups, type SignupRow } from "./stats";

export interface DigestDeps {
  events: Pick<TeamEventStore, "listBetween">;
  fetchSignups: (run: RunKey) => Promise<SignupRow[]>;
}

/**
 * Сводка дня: все события расписания. У кофе-рана недели (format = coffee_run)
 * — заявки по (спот, дата). null — на день ничего нет.
 */
export async function buildDailyDigest(deps: DigestDeps, ymd: string, now: Date): Promise<string | null> {
  const events = await deps.events.listBetween(mskMidnight(ymd), mskMidnight(addDays(ymd, 1)));
  if (!events.length) return null;
  const items: DigestItem[] = [];
  for (const event of events) {
    if (isCoffeeRunEvent(event) && event.spot) {
      const runDate = mskToday(new Date(event.starts_at));
      items.push({ kind: "event", event, runDate, stats: summarizeSignups(await deps.fetchSignups({ spot: event.spot, date: runDate }), now) });
    } else items.push({ kind: "event", event });
  }
  return dailyDigestText(ymd, items, now);
}
