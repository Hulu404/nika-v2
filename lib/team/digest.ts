import { tgAdmin } from "../telegram/supabase";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import { digestsDue, type DigestKind } from "./digest-schedule";
import { buildDigest } from "./digest-build";
import { sendTeamMessage } from "./send";
import { teamBotConfigured } from "./config";

/**
 * Рассылка сводок команде: накануне забега — как отработали напоминания,
 * утром в день старта — сколько людей и по каким группам темпа.
 *
 * Живёт рядом с рассылками участников (lib/coffeerun/*-dispatch.ts) и по тем
 * же правилам: вызывается тикером из instrumentation.ts, окно проверяет сама,
 * дедуп держит в базе.
 *
 * Про дедуп отдельно: он в таблице team_digests, а не в памяти процесса,
 * потому что тикер делает первый проход сразу при старте — то есть на каждом
 * деплое. Релиз в 7:15 утра в день забега прислал бы утреннюю сводку второй
 * раз, а релизы в день забега — обычное дело.
 *
 * Чего эта рассылка принципиально не умеет: сообщить, что умер процесс, в
 * котором она сама живёт. Если приложение лежит, молчат и напоминания, и эта
 * сводка. Она ловит другой случай — когда приложение работает, а рассылка
 * участникам не отработала; для «лежит всё» нужен внешний пинг, и это не
 * задача бота.
 */

/** Троттлинг под лимиты Telegram. Команда небольшая, но правило общее. */
const THROTTLE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TeamDigestResult {
  ok: true;
  skipped?: string;
  /** Что ушло в этот проход: «morning luzhniki/2026-09-20». */
  sent?: string[];
  recipients?: number;
  msk: { date: string; hour: number };
}

interface Recipient {
  chat_id: number;
}

/** Кому идут сводки: команда минус те, кто их отключил (/mute). */
async function recipients(): Promise<Recipient[]> {
  const { data, error } = await tgAdmin()
    .from("team_members")
    .select("chat_id")
    .eq("digest_opt_in", true);
  if (error) {
    console.error("[team-digest] recipients:", error.message);
    return [];
  }
  return (data ?? []) as Recipient[];
}

/**
 * Занять сводку под отправку. Вставка с primary key (kind, spot, run_date) —
 * она же и проверка «не отправляли»: две параллельные попытки не разойдутся,
 * вторая получит 23505 и выйдет. Читать-потом-писать здесь нельзя, тикер и
 * ручной запуск могут совпасть.
 */
async function claim(kind: DigestKind, spot: string, runDate: string): Promise<boolean> {
  const { error } = await tgAdmin()
    .from("team_digests")
    .insert({ kind, spot, run_date: runDate, sent_to: 0 });
  if (!error) return true;
  if (error.code === "23505") return false; // уже отправляли
  console.error("[team-digest] claim:", error.message);
  return false;
}

/** Записать, скольким в итоге ушло. Не критично — только для разбирательств. */
async function markSent(kind: DigestKind, spot: string, runDate: string, count: number) {
  const { error } = await tgAdmin()
    .from("team_digests")
    .update({ sent_to: count, sent_at: new Date().toISOString() })
    .eq("kind", kind)
    .eq("spot", spot)
    .eq("run_date", runDate);
  if (error) console.error("[team-digest] markSent:", error.message);
}

export interface DispatchOptions {
  /** Только посчитать и построить тексты, ничего не отправляя и не помечая. */
  dryRun?: boolean;
  now?: Date;
}

export async function dispatchTeamDigests(
  opts: DispatchOptions = {},
): Promise<TeamDigestResult> {
  const now = opts.now ?? new Date();
  const { ymd, hour } = localParts(DEFAULT_TZ, now);
  const msk = { date: ymd, hour };

  if (!teamBotConfigured()) return { ok: true, skipped: "TEAM_BOT_TOKEN не задан", msk };

  const due = digestsDue(ymd, hour);
  if (due.length === 0) return { ok: true, skipped: "нечего слать", msk };

  const to = await recipients();
  const sent: string[] = [];

  for (const item of due) {
    const id = `${item.kind} ${item.run.spot}/${item.run.date}`;

    if (opts.dryRun) {
      sent.push(id);
      continue;
    }

    // Занимаем ДО построения текста: построение ходит в базу, и за это время
    // соседний проход успел бы отправить то же самое.
    if (!(await claim(item.kind, item.run.spot, item.run.date))) continue;

    let text: string;
    try {
      text = await buildDigest(item.kind, item.run, now);
    } catch (err) {
      // Текст не построился — оставляем отметку как есть (sent_to = 0) и не
      // пытаемся снова: молчание лучше, чем сводка каждые 15 минут о том, что
      // база не отвечает. Авария и так будет видна в логах.
      console.error("[team-digest] build failed:", err instanceof Error ? err.message : String(err));
      continue;
    }

    let delivered = 0;
    for (const r of to) {
      const res = await sendTeamMessage(r.chat_id, text);
      if (res.ok) delivered++;
      await sleep(THROTTLE_MS);
    }

    await markSent(item.kind, item.run.spot, item.run.date, delivered);
    sent.push(id);
    console.log(`[team-digest] отправлено: ${id} → ${delivered} чел.`);
  }

  return { ok: true, sent, recipients: to.length, msk };
}
