#!/usr/bin/env node
/**
 * Применяет политику паролей к проекту Supabase через Management API.
 *
 * Что делает:
 *   1. читает текущий конфиг Auth и печатает поля паролей (до изменения);
 *   2. применяет новую политику (PATCH);
 *   3. печатает поля паролей после изменения.
 *
 * Запуск (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_xxx"; node scripts/apply-auth-password-policy.mjs
 *
 * Запуск (bash):
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-auth-password-policy.mjs
 *
 * Требуется:
 *   - SUPABASE_ACCESS_TOKEN — personal access token (sbp_...), берётся тут:
 *     https://supabase.com/dashboard/account/tokens
 *     (это НЕ anon/service-role ключ из .env — это токен аккаунта).
 *   - ref проекта: берётся из SUPABASE_PROJECT_REF, иначе из
 *     NEXT_PUBLIC_SUPABASE_URL (env или .env.local/.env).
 *
 * Примечание: password_hibp_enabled (защита от утёкших паролей) может быть
 * доступна только на платном плане Supabase — тогда API вернёт ошибку именно
 * по этому полю; min length и required characters применятся в любом случае.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Желаемая политика ─────────────────────────────────────────────────────────
// По современным рекомендациям (NIST 800-63B) ставка на длину + проверку утечек,
// а не на навязанный состав символов. Состав можно включить ниже при желании.
const POLICY = {
  password_min_length: 8,

  // Состав пароля. Классы символов перечисляются через ":".
  //   ""  — без требований (рекомендуется вместе с HIBP)
  //   "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789"
  //        — буквы (нижний/верхний регистр) + цифры
  //   добавить ":!@#$%^&*()_+-=[]{};'`:\"|<>?,./`~" в конец — ещё и спецсимволы
  password_required_characters: "",

  // Отклонять пароли из утечек (HaveIBeenPwned). Требует платного плана.
  password_hibp_enabled: true,
};

const PASSWORD_FIELDS = [
  "password_min_length",
  "password_required_characters",
  "password_hibp_enabled",
];

// ── Вспомогательное: достать project ref ──────────────────────────────────────
function readEnvFile(name) {
  try {
    return readFileSync(resolve(process.cwd(), name), "utf8");
  } catch {
    return "";
  }
}

/**
 * Достаёт переменную из process.env, иначе из .env.local / .env.
 * Node не подгружает .env сам, поэтому читаем файлы вручную.
 * .env.local имеет приоритет над .env (как в Next.js).
 */
function getEnvVar(name) {
  if (process.env[name]) return process.env[name];
  const content = `${readEnvFile(".env.local")}\n${readEnvFile(".env")}`;
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, "m");
  const match = content.match(re);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

function getProjectRef() {
  const explicitRef = getEnvVar("SUPABASE_PROJECT_REF");
  if (explicitRef) return explicitRef;
  const url = getEnvVar("NEXT_PUBLIC_SUPABASE_URL");
  // https://<ref>.supabase.co → <ref>
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i);
  return m ? m[1] : "";
}

// ── Запросы к Management API ──────────────────────────────────────────────────
async function getAuthConfig(ref, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET config/auth → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function patchAuthConfig(ref, token, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH config/auth → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function printFields(label, config) {
  console.log(`\n${label}:`);
  for (const f of PASSWORD_FIELDS) {
    console.log(`  ${f} = ${JSON.stringify(config[f])}`);
  }
}

// ── Точка входа ───────────────────────────────────────────────────────────────
async function main() {
  const token = getEnvVar("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    throw new Error(
      "не задан SUPABASE_ACCESS_TOKEN.\n" +
        "Создай personal access token: https://supabase.com/dashboard/account/tokens",
    );
  }

  const ref = getProjectRef();
  if (!ref) {
    throw new Error(
      "не удалось определить ref проекта.\n" +
        "Задай SUPABASE_PROJECT_REF или NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  console.log(`Проект: ${ref}`);

  const before = await getAuthConfig(ref, token);
  printFields("Текущая политика", before);

  console.log("\nПрименяю новую политику…");
  let after;
  try {
    after = await patchAuthConfig(ref, token, POLICY);
  } catch (err) {
    // HIBP доступен только на Pro. На Free план PATCH целиком отклоняется (402) —
    // повторяем без password_hibp_enabled, чтобы хотя бы длина/состав применились.
    if (/HaveIBeenPwned|leaked password/i.test(err.message)) {
      console.warn(
        "\n⚠️  Защита от утёкших паролей (HIBP) требует плана Pro — пропускаю её.\n" +
          "    Применяю остальную политику (длина/состав).",
      );
      const { password_hibp_enabled: _omit, ...rest } = POLICY;
      after = await patchAuthConfig(ref, token, rest);
    } else {
      throw err;
    }
  }
  printFields("Новая политика", after);

  console.log("\nГотово ✅");
}

main().catch((err) => {
  console.error(`\nНе удалось применить политику:\n${err.message}`);
  process.exitCode = 1;
});
