import { promises as dns } from "node:dns";
import { connect as tcpConnect } from "node:net";
import { describeNetError, forceIPv4, hostOf, recentNetErrors } from "./net";
import { LLM_URL, STT_URL, createTeamAi, supabaseAiUsage, teamAiConfig } from "./yandex";

/**
 * /ai_check — фаундер сам видит, жива ли связь с Яндексом, без логов Railway:
 * DNS (сколько IPv4 и IPv6), TCP до :443, короткий запрос к модели и ошибки
 * сети за сутки из памяти процесса. Ни один шаг не роняет проверку: ошибка —
 * строкой в ответе.
 */

export interface CheckDeps {
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>>;
  connect: (host: string, port: number) => Promise<void>;
  /** null — модель выключена (нет ключей или TEAM_AI_ENABLED ≠ true). */
  llm: (() => Promise<void>) | null;
  model: string | null;
  clock?: () => number;
  now?: () => number;
}

const TCP_TIMEOUT_MS = 5_000;

export function defaultCheckDeps(): CheckDeps {
  const cfg = teamAiConfig();
  const ai = cfg ? createTeamAi({ config: cfg, usage: supabaseAiUsage() }) : null;
  return {
    lookup: (host) => dns.lookup(host, { all: true }),
    connect: (host, port) => new Promise<void>((resolve, reject) => {
      const socket = tcpConnect({ host, port, ...(forceIPv4() ? { family: 4 } : {}) });
      const done = (err?: Error) => {
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };
      socket.setTimeout(TCP_TIMEOUT_MS, () => done(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" })));
      socket.once("connect", () => done());
      socket.once("error", (err) => done(err));
    }),
    llm: ai ? async () => {
      await ai.step({ messages: [{ role: "user", text: "Ответь одним словом: ок" }], tools: [] });
    } : null,
    model: cfg ? cfg.modelUri.replace(/^gpt:\/\/[^/]+\//, "") : null,
  };
}

const errText = (err: unknown) => {
  const info = describeNetError(err);
  return info.code ? `${info.code} ${info.message}` : info.message;
};

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} с` : `${n} мс`);

async function timed<T>(clock: () => number, work: () => Promise<T>): Promise<{ value?: T; error?: unknown; took: number }> {
  const t = clock();
  try {
    const value = await work();
    return { value, took: clock() - t };
  } catch (error) {
    return { error, took: clock() - t };
  }
}

async function hostLines(deps: CheckDeps, host: string, clock: () => number): Promise<string[]> {
  const d = await timed(clock, () => deps.lookup(host));
  const dnsLine = d.error
    ? `DNS ${host}: ошибка ${errText(d.error)} · ${ms(d.took)}`
    : `DNS ${host}: ${d.value!.filter((a) => a.family === 4).length} IPv4, ${d.value!.filter((a) => a.family === 6).length} IPv6 · ${ms(d.took)}`;
  const t = await timed(clock, () => deps.connect(host, 443));
  const tcpLine = `TCP ${host}:443: ${t.error ? `ошибка ${errText(t.error)}` : "ok"} · ${ms(t.took)}`;
  return [dnsLine, tcpLine];
}

export async function aiCheckText(deps: CheckDeps): Promise<string> {
  const clock = deps.clock ?? (() => Date.now());
  const lines = ["🔌 Проверка ИИ"];
  const llmHost = hostOf(LLM_URL);
  lines.push(...(await hostLines(deps, llmHost, clock)));
  if (!deps.llm) lines.push("LLM: выключено (нет ключей или TEAM_AI_ENABLED ≠ true)");
  else {
    const r = await timed(clock, deps.llm);
    lines.push(`LLM (короткий запрос «ответь ок»): ${r.error ? `ошибка ${errText(r.error)}` : "ok"} · ${ms(r.took)} · модель ${deps.model ?? "—"}`);
  }
  lines.push(...(await hostLines(deps, hostOf(STT_URL), clock)));
  const recent = recentNetErrors(deps.now ? deps.now() : Date.now());
  lines.push(`Последние ошибки (за 24 ч): ${recent.count}${recent.top ? ` · чаще всего ${recent.top}` : ""}`);
  return lines.join("\n");
}
