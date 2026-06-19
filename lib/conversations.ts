import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message, ScenarioType } from "@/types/app";
import type { Conversation, Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Функции работы с таблицей conversations. Клиент принимается параметром, чтобы
 * переиспользоваться в серверных компонентах, route handlers и (при необходимости)
 * в браузере — у них разные инстансы Supabase-клиента.
 */

/** Создаёт новый пустой диалог и возвращает его. */
export async function createConversation(
  supabase: Client,
  userId: string,
  scenario: ScenarioType,
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, scenario, messages: [] })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createConversation failed: ${error?.message ?? "no data"}`);
  }
  return data;
}

/** Последний (самый свежий) диалог пользователя по сценарию или null. */
export async function getLastConversation(
  supabase: Client,
  userId: string,
  scenario: ScenarioType,
): Promise<Conversation | null> {
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .eq("scenario", scenario)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Возвращает последний диалог по сценарию или создаёт новый, если его нет.
 * Удобно для потоков «продолжить или начать». Сам роут чата использует
 * createConversation, чтобы кнопка «Новый разговор» давала именно новый диалог.
 */
export async function getOrCreateConversation(
  supabase: Client,
  userId: string,
  scenario: ScenarioType,
): Promise<Conversation> {
  const last = await getLastConversation(supabase, userId, scenario);
  return last ?? createConversation(supabase, userId, scenario);
}

/**
 * Перезаписывает сообщения диалога и обновляет updated_at.
 * Фильтр по user_id — defense-in-depth поверх RLS: даже если политика когда-то
 * ослабнет, чужой диалог по подставленному id обновить нельзя.
 */
export async function updateConversation(
  supabase: Client,
  id: string,
  userId: string,
  messages: Message[],
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ messages, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    throw new Error(`updateConversation failed: ${error.message}`);
  }
}
