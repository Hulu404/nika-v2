import { mskMidnight } from "../databot/dates";
import { addDays, mskToday } from "../databot/time";
import { founderCoffeeLines, type DigestItem } from "./digest-copy";
import { isCoffeeRunEvent, type TeamEventStore } from "./events";
import type { RunKey } from "./runs";
import { summarizeSignups, type SignupRow } from "./stats";

export interface DigestDeps {
  events: Pick<TeamEventStore, "listBetween">;
  fetchSignups: (run: RunKey) => Promise<SignupRow[]>;
}

/** Блоки фаундерам про кофе-ран дня: заявки по (спот, дата). Пусто — кофе-рана нет. */
export async function buildCoffeeBlock(deps: DigestDeps, ymd: string, now: Date): Promise<string[]> {
  const events = await deps.events.listBetween(mskMidnight(ymd), mskMidnight(addDays(ymd, 1)));
  const items: DigestItem[] = [];
  for (const event of events) {
    if (!isCoffeeRunEvent(event) || !event.spot) continue;
    const runDate = mskToday(new Date(event.starts_at));
    items.push({ kind: "event", event, runDate, stats: summarizeSignups(await deps.fetchSignups({ spot: event.spot, date: runDate }), now) });
  }
  return founderCoffeeLines(items, now);
}
