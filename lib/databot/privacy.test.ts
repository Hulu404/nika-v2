import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Страж приватности бота данных (ТЗ, раздел 8; аудит, раздел 7).
 *
 * Бот ходит в базу сервисным ключом — RLS его не остановит, поэтому граница
 * «что бот вообще может прочитать» держится здесь, статическим разбором:
 *   а) TS: каждое .from/.rpc — литерал из белого списка (переменная обходит
 *      любой список, поэтому не-литерал — тоже падение); .select — без
 *      запрещённых колонок и без «*» на чужих таблицах;
 *   б) SQL: тела функций databot_* (во всех миграциях — функцию могут
 *      пересоздать позже) не упоминают запрещённое, читают только таблицы
 *      из белого списка; комментарии и '…'-строки перед поиском вырезаны;
 *   в) TS: у типов и объектов нет свойств phone/email — то, что не лежит в
 *      объекте, не утечёт в текст ответа.
 *
 * TS разбирается компилятором (AST), а не регэкспами: так «голые» слова
 * (messages в тексте ошибки, note в комментарии) не дают ложных срабатываний,
 * а Array.from(…) не путается с supabase .from(…).
 *
 * Сканеры — чистые функции от текста; внизу они же прогоняются на встроенных
 * плохих примерах, чтобы поломка самого стража была видна сразу.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TS_DIRS = ["lib/databot", "app/api/telegram/databot-webhook"];
const MIGRATIONS_DIR = "supabase/migrations";

// ─── Списки ────────────────────────────────────────────────────────────────

/** Таблицы, которые боту можно трогать (аудит 7а). */
const ALLOWED_TABLES = new Set([
  "databot_members", "databot_invites", "databot_audit", "databot_kb", "databot_run_plans", "databot_tasks", "databot_task_claims", "databot_assigned_tasks",
  "tg_sessions", "processed_updates",
  "coffee_run_signups", "coffee_run_invites",
  "link_codes", "link_clicks", "user_attribution", "qr_codes", "qr_scans", "promo_tokens",
  "subscriptions", "robokassa_payments",
  "users", "profiles", "tg_bindings", "runs", "conversations", "checkins", "sprints",
  "notifications_log",
]);

/**
 * RPC белого списка. attach_anon_to_user (пишет analytics_events) и
 * redeem_promo_token (меняет данные) сюда не входят сознательно.
 */
const ALLOWED_RPC = new Set([
  "check_rate_limit",
  "databot_run_people", "databot_runs_table", "databot_traffic", "databot_traffic_since",
  "databot_pro", "databot_product", "databot_person_key", "databot_is_team",
  // Список участников (Промт 6): имя, ник, темп, статус — без телефона и email.
  "databot_run_roster",
  "databot_task_action", "databot_task_list", "databot_task_cleanup_list", "databot_task_json",
  "databot_assigned_import", "databot_assigned_list", "databot_assigned_delivery",
]);

/**
 * Собственные таблицы бота и служебные. Только у них разрешены select("*") и
 * колонки с «опасными» именами, которые здесь значат своё: display_name и
 * chat_id сотрудника в databot_members, token приглашения в databot_invites.
 */
const SERVICE_TABLES = new Set([
  "databot_members", "databot_invites", "databot_audit", "databot_kb", "databot_run_plans", "databot_tasks", "databot_task_claims", "databot_assigned_tasks",
  "tg_sessions", "processed_updates",
]);
const SERVICE_ONLY_COLUMNS = new Set(["display_name", "token", "chat_id"]);

/** Запрещённые таблицы и вью; плюс всё, что начинается с rhythm_. */
const FORBIDDEN_TABLES = new Set([
  "daily_state", "period_marks", "personal_tips", "sprint_advice", "tg_link_tokens",
  "push_subscriptions", "notification_prefs", "notification_log", "v_coffeerun_promo",
  "analytics_events",
]);
function isForbiddenTable(word: string): boolean {
  return FORBIDDEN_TABLES.has(word) || word.startsWith("rhythm_");
}

/**
 * Колонки, которых нет ни в одной выдаче. Сверх списка ТЗ из аудита 7
 * добавлены goal (profiles.goal), user_agent и referer (link_clicks — «не
 * выдавать»), ip_hash (в TS — никогда, в SQL — только внутри count distinct).
 * rhythm_consent_* ловятся и префиксом rhythm_.
 */
const FORBIDDEN_COLUMNS = new Set([
  "messages", "goal_text", "closing_reflection", "weekly_focus", "milestones", "quiz_answers",
  "question_variant", "answer", "note", "fears", "cycle", "goal",
  "rhythm_consent_at", "rhythm_consent_version",
  "telegram_id", "first_name", "yukassa_payment_id", "promo_token",
  "email", "phone", "user_agent", "referer", "ip_hash",
]);

/**
 * Обёртки над .rpc, которым законно передают имя параметром. Внутри такой
 * функции .rpc(<первый параметр>) разрешён, зато КАЖДЫЙ её вызов в
 * просканированных файлах проверяется как .rpc: литерал из белого списка.
 * Передать обёртку значением (const f = callRpc) нельзя — это обход.
 */
const RPC_PROXIES = [{ file: "lib/databot/data/client.ts", fn: "callRpc" }];
const RPC_PROXY_NAMES = new Set(RPC_PROXIES.map((p) => p.fn));

/** Методы PostgREST-билдера, у которых строковые аргументы — имена колонок/фильтры. */
const COLUMN_METHODS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains",
  "containedBy", "overlaps", "filter", "not", "or", "match", "order", "textSearch",
  "likeAllOf", "likeAnyOf", "ilikeAllOf", "ilikeAnyOf",
]);

/** Статические .from() из JS, а не из supabase. */
const JS_STATIC_FROM = new Set([
  "Array", "Buffer", "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array",
  "Int32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "Uint8ClampedArray", "Iterator",
]);

// ─── Общее ─────────────────────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  where: string;
  what: string;
}

function fmt(v: Violation): string {
  return `${v.file}:${v.line} [${v.where}] ${v.what}`;
}

function words(s: string): string[] {
  return s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// ─── TS ────────────────────────────────────────────────────────────────────

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Имя вызываемого метода и его получатель: x.from(…), x["from"](…), callRpc(…). */
function callee(call: ts.CallExpression): { name: string; receiver: ts.Expression | null } | null {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return { name: e.name.text, receiver: e.expression };
  if (ts.isElementAccessExpression(e)) {
    const n = literalText(e.argumentExpression);
    return n === null ? null : { name: n, receiver: e.expression };
  }
  if (ts.isIdentifier(e)) return { name: e.text, receiver: null };
  return null;
}

/** Имя ближайшей именованной функции — для сообщения «где». */
function enclosingName(node: ts.Node): string {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const q = p.parent;
      if ((ts.isVariableDeclaration(q) || ts.isPropertyAssignment(q)) && q.name) return q.name.getText();
    }
  }
  return "<модуль>";
}

/** Таблица из .from("…") ниже по цепочке билдера; null — не нашли. */
function chainTable(call: ts.CallExpression): string | null {
  let e: ts.Expression | null = callee(call)?.receiver ?? null;
  while (e) {
    if (ts.isCallExpression(e)) {
      const c = callee(e);
      if (!c) return null;
      if (c.name === "from" && e.arguments.length > 0) return literalText(e.arguments[0]);
      e = c.receiver;
    } else if (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) {
      e = e.expression;
    } else {
      return null;
    }
  }
  return null;
}

function propName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/** rel — путь от корня репозитория через «/»: по нему узнаём обёртки RPC. */
function scanTs(rel: string, text: string): Violation[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const out: Violation[] = [];
  const at = (node: ts.Node, what: string) =>
    out.push({
      file: rel,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      where: enclosingName(node),
      what,
    });

  const checkTableName = (node: ts.Node, method: string, arg: ts.Node | undefined) => {
    const t = literalText(arg);
    if (t === null) {
      at(node, `.${method}(…) с не-литералом — белый список таблиц обходится переменной`);
      return;
    }
    if (isForbiddenTable(t)) at(node, `.${method}("${t}") — запрещённая таблица`);
    else if (!ALLOWED_TABLES.has(t)) at(node, `.${method}("${t}") — таблицы нет в белом списке`);
  };

  const checkRpcName = (node: ts.Node, label: string, arg: ts.Node | undefined) => {
    const r = literalText(arg);
    if (r === null) at(node, `${label}(…) с не-литералом — белый список RPC обходится переменной`);
    else if (!ALLOWED_RPC.has(r)) at(node, `${label}("${r}") — RPC нет в белом списке`);
  };

  /** Слова строкового аргумента билдера: колонки, фильтры, встроенные таблицы. */
  const checkColumnLiteral = (node: ts.Node, method: string, lit: string, table: string | null) => {
    const service = table !== null && SERVICE_TABLES.has(table);
    for (const w of words(lit)) {
      if (isForbiddenTable(w)) at(node, `.${method}("${lit}") — запрещённая таблица ${w}`);
      else if (FORBIDDEN_COLUMNS.has(w) || w.startsWith("rhythm_"))
        at(node, `.${method}("${lit}") — запрещённая колонка ${w}`);
      else if (SERVICE_ONLY_COLUMNS.has(w) && !service)
        at(node, `.${method}("${lit}") — колонка ${w} разрешена только у таблиц бота, а здесь ${table ?? "таблица не определена"}`);
    }
  };

  const visit = (node: ts.Node) => {
    // Любая строка с именем запрещённой таблицы — даже вне билдера
    // (const T = "daily_state", URL /rest/v1/…): имена у них однозначные.
    if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      for (const w of words(node.text)) if (isForbiddenTable(w)) at(node, `строка упоминает запрещённую таблицу ${w}`);
    }

    // в) свойства phone/email в типах, классах, объектах и деструктуризации.
    if (
      ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const n = propName(node.name);
      if (n === "phone" || n === "email") at(node, `свойство ${n} — телефон и email не должны попадать в данные бота`);
    }
    if (ts.isBindingElement(node)) {
      const n = propName(node.propertyName ?? node.name);
      if (n === "phone" || n === "email") at(node, `деструктуризация ${n} — телефон и email не должны попадать в данные бота`);
    }

    // Обёртку RPC можно только вызывать — иначе её вызовы не проверить.
    if (ts.isIdentifier(node) && RPC_PROXY_NAMES.has(node.text)) {
      const p = node.parent;
      const ok =
        (ts.isCallExpression(p) && p.expression === node) ||
        (ts.isFunctionDeclaration(p) && p.name === node) ||
        ts.isImportSpecifier(p) || ts.isExportSpecifier(p);
      if (!ok) at(node, `${node.text} использован не как вызов — обёртку RPC нельзя передавать значением`);
    }

    if (ts.isCallExpression(node)) {
      const c = callee(node);
      if (c) {
        const arg0 = node.arguments[0];
        if (c.name === "from" && c.receiver) {
          const skip = ts.isIdentifier(c.receiver) && JS_STATIC_FROM.has(c.receiver.text);
          if (!skip) checkTableName(node, "from", arg0);
        } else if (c.name === "rpc" && c.receiver) {
          const fn = ts.findAncestor(node, ts.isFunctionDeclaration);
          const proxy = RPC_PROXIES.find((p) => p.file === rel && fn?.name?.text === p.fn);
          const firstParam = fn?.parameters[0] ? propName(fn.parameters[0].name) : null;
          const viaProxyParam = proxy && arg0 && ts.isIdentifier(arg0) && arg0.text === firstParam;
          if (!viaProxyParam) checkRpcName(node, ".rpc", arg0);
        } else if (!c.receiver && RPC_PROXY_NAMES.has(c.name)) {
          checkRpcName(node, c.name, arg0);
        } else if (c.name === "select" && c.receiver) {
          const table = chainTable(node);
          const service = table !== null && SERVICE_TABLES.has(table);
          const lit = arg0 === undefined ? "*" : literalText(arg0);
          if (lit === null) {
            at(node, `.select(…) с не-литералом — список колонок не проверить`);
          } else {
            if (/\*/.test(lit) && !service)
              at(node, `.select("${lit}") — «*» разрешена только у таблиц бота, а здесь ${table ?? "таблица не определена"}`);
            // Встроенные ресурсы PostgREST: profiles(cohort), a:users!fk(id).
            for (const m of lit.matchAll(/([A-Za-z_]\w*)\s*(?:![\w]+)?\s*\(/g)) {
              const t = m[1];
              if (isForbiddenTable(t)) at(node, `.select("${lit}") — встроенная запрещённая таблица ${t}`);
              else if (!ALLOWED_TABLES.has(t)) at(node, `.select("${lit}") — встроенной таблицы ${t} нет в белом списке`);
            }
            checkColumnLiteral(node, "select", lit, table);
          }
        } else if (COLUMN_METHODS.has(c.name) && c.receiver) {
          const table = chainTable(node);
          for (const a of node.arguments) {
            const lit = literalText(a);
            if (lit !== null) checkColumnLiteral(node, c.name, lit, table);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ─── SQL ───────────────────────────────────────────────────────────────────

/**
 * Комментарии (-- …, / * … * /) и '…'-строки заменяются пробелами той же
 * длины: переводы строк остаются, и номера строк в сообщениях честные.
 * Слово в комментарии — не обращение к таблице; строка — значение, а не имя.
 */
function stripSql(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") j += 2;
        else if (text[j] === "'") break;
        else j++;
      }
      blank(i, j + 1);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

interface SqlFunction {
  name: string;
  header: string;
  body: string;
  /** Смещение тела в файле — для номеров строк. */
  bodyOffset: number;
}

/** Функции databot_* из уже очищенного текста: тело — между `as $tag$` и закрывающим `$tag$`. */
function extractDatabotFunctions(stripped: string): SqlFunction[] {
  const out: SqlFunction[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(databot_\w+)\s*\(/gi;
  for (const m of stripped.matchAll(re)) {
    const start = m.index ?? 0;
    const asRe = /\bas\s+(\$[A-Za-z0-9_]*\$)/gi;
    asRe.lastIndex = start;
    const as = asRe.exec(stripped);
    if (!as) continue;
    const bodyOffset = as.index + as[0].length;
    const end = stripped.indexOf(as[1], bodyOffset);
    if (end === -1) continue;
    out.push({
      name: m[1].toLowerCase(),
      header: stripped.slice(start, as.index),
      body: stripped.slice(bodyOffset, end),
      bodyOffset,
    });
  }
  return out;
}

/** Заменить совпадения пробелами той же длины — смещения остальных находок не плывут. */
function cut(body: string, re: RegExp): string {
  return body.replace(re, (s) => " ".repeat(s.length));
}

/**
 * Разрешённые места для token/promo_token. Оба — внутри databot_pro и в
 * выдачу не попадают (функция отдаёт только счётчики):
 *   1) условие join `pt.token = a.promo_token` (в любую сторону) — так
 *      находится погашение кода этой подписки;
 *   2) перенос s.promo_token в CTE active_sub, из которого его берёт п.1.
 *      Шаблон намеренно точный: любая правка этого select потребует
 *      взглянуть сюда ещё раз.
 * Всё остальное с token/promo_token — нарушение, в том числе в
 * jsonb_build_object и в returns table.
 */
const TOKEN_ALLOWED: RegExp[] = [
  /\b\w+\.token\s*=\s*\w+\.promo_token\b/gi,
  /\b\w+\.promo_token\s*=\s*\w+\.token\b/gi,
  /\bselect\s+s\.user_id\s*,\s*s\.source\s*,\s*s\.promo_token\s*,\s*s\.current_period_end\s+from\s+public\.subscriptions\s+s\b/gi,
];

/** Вызов функции ключа человека с email третьим аргументом — единственное законное место email. */
const PERSON_KEY_CALL = /\b(?:public\.)?databot_person_key\s*\(\s*[\w.]+\s*,\s*[\w.]+\s*,\s*(?:(\w+)\.)?email\s*\)/gi;

/** SQL-специфика: display_name и chat_id функциям не нужны вообще. */
const SQL_FORBIDDEN_COLUMNS = new Set([...FORBIDDEN_COLUMNS, "display_name", "chat_id"]);
SQL_FORBIDDEN_COLUMNS.delete("email"); // особые правила ниже
SQL_FORBIDDEN_COLUMNS.delete("ip_hash");
SQL_FORBIDDEN_COLUMNS.delete("promo_token");

/** После from/join без таблицы: подзапрос, lateral и т.п. — не имена таблиц. */
const FROM_SKIP = new Set(["lateral", "only", "select", "unnest", "generate_series", "jsonb_each", "jsonb_array_elements"]);

function scanSql(rel: string, text: string): Violation[] {
  const stripped = stripSql(text);
  const out: Violation[] = [];
  for (const fn of extractDatabotFunctions(stripped)) {
    const hit = (local: number, what: string) =>
      out.push({ file: rel, line: lineAt(text, fn.bodyOffset + local), where: fn.name, what });
    const findAll = (body: string, re: RegExp, what: (m: RegExpMatchArray) => string) => {
      for (const m of body.matchAll(re)) hit(m.index ?? 0, what(m));
    };
    const body = fn.body;

    // Динамический SQL строит имена строками — сканер их не увидит.
    findAll(body, /\bexecute\b/gi, () => "execute — динамический SQL обходит проверку имён");

    for (const m of body.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const w = m[0].toLowerCase();
      if (isForbiddenTable(w)) hit(m.index ?? 0, `запрещённая таблица ${w}`);
      else if (SQL_FORBIDDEN_COLUMNS.has(w) && !(w === "chat_id" && (fn.name.startsWith("databot_task_") || fn.name.startsWith("databot_assigned_"))))
        hit(m.index ?? 0, `запрещённая колонка ${w}`);
    }

    // Белый список со стороны SQL: всё public.<имя> — таблица из списка или
    // функция databot_*; всё после from/join — таблица, CTE или параметр.
    findAll(body, /\bpublic\.(\w+)/gi, (m) => {
      const n = m[1].toLowerCase();
      return ALLOWED_TABLES.has(n) || ALLOWED_RPC.has(n) ? "" : `public.${n} — нет в белом списке таблиц и функций`;
    });
    const ctes = new Set([...body.matchAll(/\b(\w+)\s+as\s*(?:not\s+)?(?:materialized\s+)?\(/gi)].map((m) => m[1].toLowerCase()));
    const params = new Set(words(fn.header).map((w) => w.toLowerCase()).filter((w) => w.startsWith("p_")));
    // «a is distinct from b» — сравнение, а не источник строк.
    findAll(cut(body, /\bis\s+(?:not\s+)?distinct\s+from\b/gi), /\b(?:from|join)\s+(?:public\.)?(\w+)/gi, (m) => {
      const n = m[1].toLowerCase();
      if (ALLOWED_TABLES.has(n) || ctes.has(n) || params.has(n) || FROM_SKIP.has(n) || isForbiddenTable(n)) return "";
      return `from/join ${n} — таблицы нет в белом списке`;
    });

    // email: только третьим аргументом databot_person_key и не у users.
    const usersAliases = new Set(["users"]);
    for (const m of body.matchAll(/\b(?:public\.)?users\s+(?:as\s+)?(\w+)/gi)) usersAliases.add(m[1].toLowerCase());
    findAll(body, PERSON_KEY_CALL, (m) =>
      m[1] && usersAliases.has(m[1].toLowerCase()) ? `databot_person_key(…, ${m[1]}.email) — users.email запрещён всегда` : "",
    );
    findAll(cut(body, PERSON_KEY_CALL), /\bemail\b/gi, () => "email вне databot_person_key(…, …, x.email)");
    if (fn.name !== "databot_person_key") {
      findAll(body, /\bp_email\b/gi, () => "p_email вне самой databot_person_key");
    }

    // token/promo_token: только разрешённые фрагменты (см. TOKEN_ALLOWED).
    let tokenBody = body;
    for (const re of TOKEN_ALLOWED) tokenBody = cut(tokenBody, re);
    findAll(tokenBody, /\b(token|promo_token)\b/gi, (m) => `${m[1]} вне разрешённого join — код и токен промо не выдаются`);

    // ip_hash: только внутри count(distinct coalesce(…)) — уникальные посетители.
    findAll(
      cut(body, /\bcount\s*\(\s*distinct\s+coalesce\s*\([^()]*\bip_hash\b[^()]*\)\s*\)/gi),
      /\bip_hash\b/gi,
      () => "ip_hash вне count(distinct coalesce(…))",
    );
  }
  return out.filter((v) => v.what !== "");
}

// ─── Обход репозитория ─────────────────────────────────────────────────────

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkTs(rel));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const tsFiles = TS_DIRS.flatMap(walkTs);
const sqlFiles = readdirSync(path.join(ROOT, MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => `${MIGRATIONS_DIR}/${f}`);
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function expectClean(list: Violation[]) {
  const lines = list.map(fmt);
  expect(lines, `\nНарушения приватности бота данных:\n${lines.join("\n")}\n`).toEqual([]);
}

describe("приватность бота данных: код", () => {
  it("обход нашёл файлы бота (иначе проверять нечего)", () => {
    expect(tsFiles).toContain("lib/databot/cleanup.ts");
    expect(tsFiles).toContain("lib/databot/data/supabase-store.ts");
    expect(tsFiles).toContain("app/api/telegram/databot-webhook/route.ts");
  });

  it("TS: .from/.rpc — только белый список литералами, .select без запрещённого, нет phone/email", () => {
    expectClean(tsFiles.flatMap((f) => scanTs(f, read(f))));
  });

  it("SQL: все функции 037 на месте", () => {
    const names = extractDatabotFunctions(stripSql(read(`${MIGRATIONS_DIR}/037_databot.sql`))).map((f) => f.name);
    const taskNames = extractDatabotFunctions(stripSql(read(`${MIGRATIONS_DIR}/038_databot_tasks.sql`))).map((f) => f.name);
    const assignedNames = extractDatabotFunctions(stripSql(read(`${MIGRATIONS_DIR}/039_databot_assigned_tasks.sql`))).map((f) => f.name);
    for (const rpc of ALLOWED_RPC) if (rpc.startsWith("databot_"))
      expect(rpc.startsWith("databot_task_") ? taskNames : rpc.startsWith("databot_assigned_") ? assignedNames : names).toContain(rpc);
  });

  it("SQL: тела функций databot_* во всех миграциях не трогают запрещённое", () => {
    expectClean(sqlFiles.flatMap((f) => scanSql(f, read(f))));
  });
});

// ─── Самопроверка сканеров ────────────────────────────────────────────────

const whats = (list: Violation[]) => list.map((v) => v.what).join("\n");

describe("приватность: сканер TS ловит нарушения", () => {
  const scan = (code: string, rel = "lib/databot/fixture.ts") => scanTs(rel, code);

  it("запрещённая таблица в .from", () => {
    const v = scan(`async function f(db: any) { await db.from('daily_state').select('user_id'); }`);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatchObject({ line: 1, where: "f" });
    expect(whats(v)).toMatch(/daily_state/);
  });

  it("таблица не из белого списка и не-литерал в .from", () => {
    expect(whats(scan(`db.from("user_day_facts")`))).toMatch(/нет в белом списке/);
    expect(whats(scan(`const t = "users"; db.from(t)`))).toMatch(/не-литерал/);
    expect(whats(scan("db.from(`users_${x}`)"))).toMatch(/не-литерал/);
    expect(whats(scan(`db["from"]("period_marks")`))).toMatch(/period_marks/);
    expect(whats(scan(`db.from("rhythm_cycles")`))).toMatch(/rhythm_cycles/);
  });

  it("RPC вне списка и не-литерал", () => {
    expect(whats(scan(`db.rpc("attach_anon_to_user")`))).toMatch(/нет в белом списке/);
    expect(whats(scan(`db.rpc(name)`))).toMatch(/не-литерал/);
    expect(whats(scan(`callRpc("redeem_promo_token", {})`))).toMatch(/нет в белом списке/);
    expect(whats(scan(`callRpc(n, {})`))).toMatch(/не-литерал/);
    expect(whats(scan(`const f = callRpc;`))).toMatch(/не как вызов/);
  });

  it(".rpc(name) законен только внутри обёртки и только с её параметром", () => {
    const proxy = `export async function callRpc(name: string, a: object) { return db().rpc(name, a); }`;
    expect(scanTs("lib/databot/data/client.ts", proxy)).toEqual([]);
    expect(whats(scan(proxy))).toMatch(/не-литерал/); // тот же код в другом файле
    const other = `export async function callRpc(name: string, a: object) { const x = "u"; return db().rpc(x, a); }`;
    expect(whats(scanTs("lib/databot/data/client.ts", other))).toMatch(/не-литерал/);
  });

  it("запрещённые колонки в .select и фильтрах", () => {
    expect(whats(scan(`db.from("users").select("id, email")`))).toMatch(/email/);
    expect(whats(scan(`db.from("conversations").select("user_id, messages")`))).toMatch(/messages/);
    expect(whats(scan(`db.from("runs").select("created_at").eq("note", "x")`))).toMatch(/note/);
    expect(whats(scan(`db.from("sprints").select("id").or("goal_text.is.null")`))).toMatch(/goal_text/);
    expect(whats(scan(`db.from("users").select("id, profiles(cycle)")`))).toMatch(/cycle/);
    expect(whats(scan(`db.from("users").select("id, daily_state(note)")`))).toMatch(/встроенная запрещённая/);
    expect(whats(scan(`db.from("users").select(cols)`))).toMatch(/не-литерал/);
  });

  it("«*» и служебные колонки — только у таблиц бота", () => {
    expect(whats(scan(`db.from("users").select("*")`))).toMatch(/«\*»/);
    expect(whats(scan(`db.from("users").insert({}).select()`))).toMatch(/«\*»/);
    expect(whats(scan(`db.from("users").select("display_name")`))).toMatch(/display_name/);
    expect(whats(scan(`db.from("promo_tokens").select("code, token")`))).toMatch(/token/);
    expect(scan(`db.from("databot_members").select("*").eq("chat_id", 1)`)).toEqual([]);
    expect(scan(`db.from("databot_members").select("chat_id, display_name")`)).toEqual([]);
    expect(scan(`db.from("databot_invites").update({}).eq("token", t).select("zone, created_by")`)).toEqual([]);
  });

  it("phone/email в типах и объектах", () => {
    expect(whats(scan(`interface P { name: string; phone?: string }`))).toMatch(/phone/);
    expect(whats(scan(`type P = { email: string }`))).toMatch(/email/);
    expect(whats(scan(`const p = { email: row.email }`))).toMatch(/email/);
    expect(whats(scan(`const { phone } = row`))).toMatch(/phone/);
  });

  it("чистый код и «голые» слова — не нарушение", () => {
    const ok = `
      // тут говорится про daily_state и messages — это комментарий
      const hex = Array.from(bytes, (b) => b.toString(16)).join("");
      const msg = "note: messages answer email";
      async function g(db: any) {
        await db.from("coffee_run_signups").select("spot, run_date, name, tg_username").eq("spot", s);
        await db.from("tg_sessions").select("value").like("key", "data:%");
        await callRpc("databot_pro", { p_from: a, p_to: b });
      }`;
    expect(scan(ok)).toEqual([]);
  });

  it("имя запрещённой таблицы в любой строке", () => {
    expect(whats(scan(`const T = "daily_state";`))).toMatch(/строка упоминает/);
    expect(whats(scan("const u = `/rest/v1/v_coffeerun_promo?x=${a}`;"))).toMatch(/v_coffeerun_promo/);
  });
});

describe("приватность: сканер SQL ловит нарушения", () => {
  const fn = (name: string, body: string, params = "p_from timestamptz") =>
    `-- шапка: daily_state тут в комментарии\ncreate or replace function public.${name}(${params})\nreturns jsonb\nlanguage sql stable\nas $$\n${body}\n$$;\n`;

  it("daily_state в теле — ловит, с именем функции и строкой", () => {
    const v = scanSql("m.sql", fn("databot_product", "  select count(*)\n    from public.daily_state d;"));
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatchObject({ where: "databot_product", line: 7 });
    expect(whats(v)).toMatch(/daily_state/);
  });

  it("daily_state только в комментарии или строке — не ловит", () => {
    const body = "  -- не читаем daily_state\n  /* и period_marks */\n  select 'daily_state' as t from public.users u;";
    expect(scanSql("m.sql", fn("databot_product", body))).toEqual([]);
  });

  it("запрещённое вне databot_* не проверяется", () => {
    expect(scanSql("m.sql", fn("other_fn", "select note from public.daily_state;"))).toEqual([]);
  });

  it("запрещённые колонки и таблицы по именам", () => {
    expect(whats(scanSql("m.sql", fn("databot_x", "select c.messages from public.conversations c;")))).toMatch(/messages/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select 1 from public.rhythm_checkins;")))).toMatch(/rhythm_checkins/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select 1 from public.notification_log;")))).toMatch(/notification_log/);
    expect(scanSql("m.sql", fn("databot_x", "select count(*) from public.notifications_log n;"))).toEqual([]);
    expect(whats(scanSql("m.sql", fn("databot_x", "select u.display_name from public.users u;")))).toMatch(/display_name/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select 1 from public.user_day_facts;")))).toMatch(/нет в белом списке/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select 1 from secret_table;")))).toMatch(/нет в белом списке/);
    expect(whats(scanSql("m.sql", fn("databot_x", "execute format('select 1');")))).toMatch(/execute/);
  });

  it("email — только третьим аргументом databot_person_key и не у users", () => {
    const ok = "select public.databot_person_key(cs.tg_username, cs.contact, cs.email) from public.coffee_run_signups cs;";
    expect(scanSql("m.sql", fn("databot_x", ok))).toEqual([]);
    expect(whats(scanSql("m.sql", fn("databot_x", "select u.email from public.users u;")))).toMatch(/email/);
    const viaUsers = "select public.databot_person_key(u.a, u.b, u.email) from public.users u;";
    expect(whats(scanSql("m.sql", fn("databot_x", viaUsers)))).toMatch(/users\.email/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select p_email;", "p_email text")))).toMatch(/p_email/);
    expect(scanSql("m.sql", fn("databot_person_key", "select lower(p_email);", "p_email text"))).toEqual([]);
  });

  it("promo_token/token — только в join-условии", () => {
    const join = "select 1 from public.subscriptions a left join public.promo_tokens pt on pt.token = a.promo_token;";
    expect(scanSql("m.sql", fn("databot_x", join))).toEqual([]);
    const leak = "select jsonb_build_object('t', a.promo_token) from public.subscriptions a;";
    expect(whats(scanSql("m.sql", fn("databot_x", leak)))).toMatch(/promo_token/);
    expect(whats(scanSql("m.sql", fn("databot_x", "select pt.token from public.promo_tokens pt;")))).toMatch(/token/);
  });

  it("«is distinct from» — не источник строк", () => {
    const ok = "select 1 from public.sprints sp where sp.status is distinct from 'x' or sp.status is not distinct from null;";
    expect(scanSql("m.sql", fn("databot_x", ok))).toEqual([]);
  });

  it("ip_hash — только внутри count(distinct coalesce(…))", () => {
    const ok = "select count(distinct coalesce(cl.anon_id::text, cl.ip_hash)) from public.link_clicks cl;";
    expect(scanSql("m.sql", fn("databot_x", ok))).toEqual([]);
    expect(whats(scanSql("m.sql", fn("databot_x", "select cl.ip_hash from public.link_clicks cl;")))).toMatch(/ip_hash/);
  });

  it("stripSql сохраняет переводы строк и понимает ''", () => {
    const s = stripSql("a -- x\nb 'it''s daily_state' c\n/* d\ne */ f");
    expect(s.split("\n").length).toBe(4);
    expect(s).not.toMatch(/daily_state|x|d|e/);
    expect(s).toMatch(/a[\s\S]*b[\s\S]*c[\s\S]*f/);
  });
});
