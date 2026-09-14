import type { CoffeeRun } from "../coffeerun/run";
import { teamRun } from "./runs";
import { fetchRunSignups, summarizeSignups } from "./stats";
import { digestText } from "./digest-copy";
import type { DigestKind } from "./digest-schedule";

/**
 * Построение текста сводки. Отдельно и от рассылки, и от бота, потому что
 * читают его оба: рассылка — чтобы отправить, бот — чтобы показать
 * предпросмотр по команде /digest.
 *
 * Предпросмотр здесь не роскошь. Сообщение, которое уходит команде само в семь
 * утра, должно быть можно прочитать заранее, днём, — иначе единственный способ
 * увидеть опечатку в нём это получить его в семь утра.
 */
export async function buildDigest(
  kind: DigestKind,
  run: CoffeeRun | { spot: string; date: string },
  now: Date = new Date(),
): Promise<string> {
  const target = teamRun({ spot: run.spot, date: run.date }, now);
  const stats = summarizeSignups(await fetchRunSignups(target), now);
  return digestText(kind, target, stats, now);
}
