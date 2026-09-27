import type { AuditEntry, InviteRow, MemberRow, Zone } from "../types";

/**
 * Всё, что бот данных делает со своими таблицами, — через этот интерфейс.
 * Боевая реализация — supabase-store.ts, для тестов — memory-store.ts.
 *
 * Соглашение об ошибках: чтение, от которого зависит ответ (членство, состав
 * команды), при сбое базы БРОСАЕТ исключение — чтобы конвейер отличил аварию от
 * «никого нет». Запись журнала и отметки «был в боте» не бросают никогда.
 */
export interface DatabotStore {
  /** Активный участник по chat_id — одна выборка по первичному ключу, без кеша. */
  findActiveMember(chatId: number): Promise<MemberRow | null>;

  /** Любой участник, включая убранного, — для имени пригласившего. */
  findMember(chatId: number): Promise<MemberRow | null>;

  /** Активные участники, для экрана «Команда». */
  listMembers(): Promise<MemberRow[]>;

  /** Обновить ник, имя, last_seen_at и is_owner (отражение env). Не бросает. */
  touchMember(
    chatId: number,
    patch: { username: string | null; display_name: string | null; is_owner: boolean },
    now: Date,
  ): Promise<void>;

  /**
   * Добавить или реактивировать участника с этой зоной: is_active = true,
   * removed_at = null. joined_at у существующей строки не трогаем.
   */
  upsertMember(
    row: {
      chat_id: number;
      zone: Zone;
      is_owner: boolean;
      invited_by: number | null;
      username: string | null;
      display_name: string | null;
    },
    now: Date,
  ): Promise<MemberRow>;

  /** Сменить зону активному участнику. false — такого активного нет. */
  setZone(chatId: number, zone: Zone): Promise<boolean>;

  /** Убрать: is_active = false, removed_at = now. false — такого активного нет. */
  removeMember(chatId: number, now: Date): Promise<boolean>;

  createInvite(row: Pick<InviteRow, "token" | "zone" | "created_by" | "expires_at">, now: Date): Promise<InviteRow>;

  /**
   * Погасить приглашение ОДНОЙ командой: used_at/used_by проставляются только
   * если токен есть, не использован и не истёк к моменту now. null — погасить
   * нельзя (нет, использован или истёк).
   */
  redeemInvite(token: string, chatId: number, now: Date): Promise<{ zone: Zone; created_by: number } | null>;

  findInvite(token: string): Promise<InviteRow | null>;

  /** Строки журнала с created_at >= since: кто и какой отчёт. Для «Команды». */
  auditSince(since: Date): Promise<Array<{ chat_id: number; report: string }>>;

  /** Запись журнала. Не бросает: сбой журнала не ломает ответ. */
  writeAudit(entry: AuditEntry): Promise<void>;

  /** Стереть состояние форм человека (tg_sessions, ключ data:<chat_id>). */
  clearSession(chatId: number): Promise<void>;

  /**
   * check_rate_limit: true — можно. Fail-open, как lib/rate-limit.ts: сбой
   * лимитера не должен оставить команду без ответа.
   */
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
