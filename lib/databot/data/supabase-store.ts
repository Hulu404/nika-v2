import type { SupabaseClient } from "@supabase/supabase-js";
import { tgAdmin } from "../../telegram/supabase";
import { asFormState, type FormState } from "../form";
import type { AuditEntry, InviteRow, MemberRow, Zone } from "../types";
import type { DatabotStore } from "./store";

/**
 * Боевое хранилище бота данных: таблицы databot_* из 037, tg_sessions и
 * check_rate_limit. Семантика один в один с memory-store.ts — тесты конвейера
 * гоняются на нём, и любое расхождение здесь было бы багом, который тесты не
 * поймают.
 *
 * Клиент — tgAdmin(), а не lib/rate-limit.ts / lib/supabase-server: те
 * помечены "server-only" и падают под tsx в scripts/databot-dev.ts, а бот
 * данных обязан одинаково работать и в вебхуке, и на long-polling.
 */

/** ТЗ, раздел 7: запрос к базе дольше 10 секунд считаем сбоем. */
const DB_TIMEOUT_MS = 10_000;

const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

type Row = Record<string, unknown>;

/**
 * bigint из PostgREST приходит числом или строкой — в зависимости от версии и
 * от того, влезает ли значение в double. chat_id всегда влезает (< 2^53, см.
 * validate.ts), а сравнение m.chat_id === subject.chatId строку не простит.
 */
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

function toMember(r: Row): MemberRow {
  return {
    chat_id: num(r.chat_id),
    username: (r.username as string | null) ?? null,
    display_name: (r.display_name as string | null) ?? null,
    zone: r.zone as Zone,
    is_owner: r.is_owner === true,
    invited_by: numOrNull(r.invited_by),
    joined_at: r.joined_at as string,
    last_seen_at: (r.last_seen_at as string | null) ?? null,
    is_active: r.is_active === true,
    removed_at: (r.removed_at as string | null) ?? null,
  };
}

function toInvite(r: Row): InviteRow {
  return {
    token: r.token as string,
    zone: r.zone as Zone,
    created_by: num(r.created_by),
    created_at: r.created_at as string,
    expires_at: r.expires_at as string,
    used_at: (r.used_at as string | null) ?? null,
    used_by: numOrNull(r.used_by),
  };
}

/** Ошибка чтения, от которой зависит ответ: бросаем, чтобы конвейер отличил аварию от «никого нет». */
function fail(op: string, message: string): never {
  throw new Error(`databot store: ${op}: ${message}`);
}

class SupabaseStore implements DatabotStore {
  // Клиент берём лениво, на каждом вызове: tgAdmin() сам кеширует, а без env
  // конструктор не должен падать — createSupabaseStore() зовётся при сборке
  // бота, в том числе там, где до базы дело не дойдёт (тесты webhook-роута).
  private get db(): SupabaseClient {
    return tgAdmin();
  }

  async findActiveMember(chatId: number): Promise<MemberRow | null> {
    const { data, error } = await this.db
      .from("databot_members")
      .select("*")
      .eq("chat_id", chatId)
      .eq("is_active", true)
      .abortSignal(timeout())
      .maybeSingle();
    if (error) fail("findActiveMember", error.message);
    return data ? toMember(data) : null;
  }

  async findMember(chatId: number): Promise<MemberRow | null> {
    const { data, error } = await this.db
      .from("databot_members")
      .select("*")
      .eq("chat_id", chatId)
      .abortSignal(timeout())
      .maybeSingle();
    if (error) fail("findMember", error.message);
    return data ? toMember(data) : null;
  }

  async listMembers(): Promise<MemberRow[]> {
    const { data, error } = await this.db
      .from("databot_members")
      .select("*")
      .eq("is_active", true)
      .order("joined_at", { ascending: true })
      .abortSignal(timeout());
    if (error) fail("listMembers", error.message);
    return (data ?? []).map(toMember);
  }

  async touchMember(
    chatId: number,
    patch: { username: string | null; display_name: string | null; is_owner: boolean },
    now: Date,
  ): Promise<void> {
    // Только активным — как в memory-store: убранный не должен «оживать» в
    // списке с новым last_seen_at от того, что написал боту.
    try {
      const { error } = await this.db
        .from("databot_members")
        .update({ ...patch, last_seen_at: now.toISOString() })
        .eq("chat_id", chatId)
        .eq("is_active", true)
        .abortSignal(timeout());
      if (error) console.error("[databot] touchMember:", error.message);
    } catch (err) {
      // chat_id в прод-лог не пишем: это идентификатор человека.
      console.error("[databot] touchMember:", err instanceof Error ? err.message : String(err));
    }
  }

  async upsertMember(
    row: {
      chat_id: number;
      zone: Zone;
      is_owner: boolean;
      invited_by: number | null;
      username: string | null;
      display_name: string | null;
    },
    now: Date,
  ): Promise<MemberRow> {
    // joined_at намеренно не передаём: у новой строки его поставит default
    // now(), у существующей upsert обновит только перечисленные колонки —
    // вернувшийся по новому приглашению сохраняет дату первого входа.
    const { data, error } = await this.db
      .from("databot_members")
      .upsert(
        {
          ...row,
          is_active: true,
          removed_at: null,
          last_seen_at: now.toISOString(),
        },
        { onConflict: "chat_id" },
      )
      .select("*")
      .abortSignal(timeout())
      .single();
    if (error) fail("upsertMember", error.message);
    return toMember(data);
  }

  async setZone(chatId: number, zone: Zone): Promise<boolean> {
    const { data, error } = await this.db
      .from("databot_members")
      .update({ zone })
      .eq("chat_id", chatId)
      .eq("is_active", true)
      .select("chat_id")
      .abortSignal(timeout());
    if (error) fail("setZone", error.message);
    return (data?.length ?? 0) > 0;
  }

  async removeMember(chatId: number, now: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from("databot_members")
      .update({ is_active: false, removed_at: now.toISOString() })
      .eq("chat_id", chatId)
      .eq("is_active", true)
      .select("chat_id")
      .abortSignal(timeout());
    if (error) fail("removeMember", error.message);
    return (data?.length ?? 0) > 0;
  }

  async createInvite(
    row: Pick<InviteRow, "token" | "zone" | "created_by" | "expires_at">,
    now: Date,
  ): Promise<InviteRow> {
    const { data, error } = await this.db
      .from("databot_invites")
      .insert({ ...row, created_at: now.toISOString() })
      .select("*")
      .abortSignal(timeout())
      .single();
    if (error) fail("createInvite", error.message);
    return toInvite(data);
  }

  async redeemInvite(
    token: string,
    chatId: number,
    now: Date,
  ): Promise<{ zone: Zone; created_by: number } | null> {
    // ОДНА команда: проверка «не использовано и не истекло» и отметка идут в
    // одном update, так что двое, нажавшие одну ссылку одновременно, не войдут
    // оба — второй получит ноль строк. Сначала select, потом update дал бы
    // обоим пройти проверку.
    const { data, error } = await this.db
      .from("databot_invites")
      .update({ used_at: now.toISOString(), used_by: chatId })
      .eq("token", token)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select("zone, created_by")
      .abortSignal(timeout())
      .maybeSingle();
    if (error) fail("redeemInvite", error.message);
    if (!data) return null;
    return { zone: data.zone as Zone, created_by: num(data.created_by) };
  }

  async findInvite(token: string): Promise<InviteRow | null> {
    const { data, error } = await this.db
      .from("databot_invites")
      .select("*")
      .eq("token", token)
      .abortSignal(timeout())
      .maybeSingle();
    if (error) fail("findInvite", error.message);
    return data ? toInvite(data) : null;
  }

  async auditSince(since: Date): Promise<Array<{ chat_id: number; report: string }>> {
    // range(0, 9999): PostgREST по умолчанию отдаёт до 1000 строк, а за месяц
    // команда легко нащёлкает больше — «Команда» тогда тихо занизила бы цифры.
    const { data, error } = await this.db
      .from("databot_audit")
      .select("chat_id, report")
      .gte("created_at", since.toISOString())
      .range(0, 9999)
      .abortSignal(timeout());
    if (error) fail("auditSince", error.message);
    return (data ?? []).map((r) => ({ chat_id: num(r.chat_id), report: r.report as string }));
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    // Сбой журнала не ломает ответ: человек уже получил цифры, и терять ответ
    // из-за того, что не записалась строка лога, — худший из размена.
    try {
      const { error } = await this.db
        .from("databot_audit")
        .insert({
          chat_id: entry.chat_id,
          zone: entry.zone,
          report: entry.report,
          params: entry.params,
          source: entry.source,
          ok: entry.ok,
          error: entry.error ?? null,
          latency_ms: entry.latency_ms ?? null,
          raw_text: entry.raw_text ?? null,
        })
        .abortSignal(timeout());
      if (error) console.error("[databot] writeAudit:", error.message);
    } catch (err) {
      console.error("[databot] writeAudit:", err instanceof Error ? err.message : String(err));
    }
  }

  async clearSession(chatId: number): Promise<void> {
    // Не бросает, как и memory-store: застрявший шаг формы — меньшее зло, чем
    // упавший ответ на «Отмена», а ключ data:% старше суток всё равно сотрёт
    // ежедневная уборка (cleanup.ts).
    try {
      const { error } = await this.db
        .from("tg_sessions")
        .delete()
        .eq("key", `data:${chatId}`)
        .abortSignal(timeout());
      if (error) console.error("[databot] clearSession:", error.message);
    } catch (err) {
      console.error("[databot] clearSession:", err instanceof Error ? err.message : String(err));
    }
  }

  async getForm(chatId: number): Promise<FormState | null> {
    const { data, error } = await this.db
      .from("tg_sessions")
      .select("value")
      .eq("key", `data:${chatId}`)
      .abortSignal(timeout())
      .maybeSingle();
    if (error) fail("getForm", error.message);
    return data ? asFormState(data.value) : null;
  }

  async setForm(chatId: number, form: FormState, now: Date): Promise<void> {
    // updated_at ставим явно: триггера на tg_sessions нет (аудит, п. 5), а по
    // нему ежедневная уборка стирает брошенные формы старше суток.
    const { error } = await this.db
      .from("tg_sessions")
      .upsert({ key: `data:${chatId}`, value: form, updated_at: now.toISOString() }, { onConflict: "key" })
      .abortSignal(timeout());
    if (error) fail("setForm", error.message);
  }

  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    // Fail-open, как lib/rate-limit.ts: лимитер — страховка от злоупотребления,
    // а не единственная защита; его сбой не должен оставить команду без ответа.
    try {
      const { data, error } = await this.db
        .rpc("check_rate_limit", {
          p_key: key,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        })
        .abortSignal(timeout());
      if (error) {
        console.error("[databot] check_rate_limit rpc failed:", error.message);
        return true;
      }
      return data === true;
    } catch (err) {
      console.error(
        "[databot] check_rate_limit rpc failed:",
        err instanceof Error ? err.message : String(err),
      );
      return true;
    }
  }
}

export function createSupabaseStore(): DatabotStore {
  return new SupabaseStore();
}
