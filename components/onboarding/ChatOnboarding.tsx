"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClientComponentClient } from "@/lib/supabase";
import { saveOnboarding } from "@/lib/profile";
import type { NotifPermission } from "@/types/app";
import {
  STEP,
  STEPPER_LABELS,
  plan,
  nextOf,
  prevOf,
  type Answers,
  type StepId,
} from "./script";

// Текст демо-уведомления (превью в интерфейсе и настоящий OS-пуш при granted).
const SAMPLE_PUSH = "Завтра твой забег. Сегодня просто выспись.";

/** Системный запрос разрешения на уведомления. Безопасно вне браузера/без API. */
async function requestNotifPermission(): Promise<NotifPermission> {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      return (await Notification.requestPermission()) as NotifPermission;
    }
  } catch {
    /* игнорируем — вернём 'default' */
  }
  return "default";
}

/** Реплика Ники по результату системного запроса (тексты финальные). */
function permissionAck(res: NotifPermission): string {
  if (res === "granted") return "Спасибо, что впустила. Писать буду редко и по делу, не на ночь глядя.";
  if (res === "denied") return "Поняла. Уведомления пока выключены, включишь в настройках, когда захочешь.";
  return "Хорошо, спрошу в другой раз. Это всегда можно включить в настройках.";
}

/** Пытается показать настоящее ОС-уведомление (только при granted). */
function tryOsNotification(body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Ника", { body });
    }
  } catch {
    /* уведомление не критично — баннер в интерфейсе показываем всегда */
  }
}

// ─── финальные тексты (собираются из состояния) ───────────────────────────────

function farewell(a: Answers): string[] {
  const name = a.name || "Привет";
  const opening =
    a.gender === "female"
      ? `${name}, рада, что ты здесь.`
      : a.gender === "male"
        ? `${name}, рад, что ты здесь.`
        : `${name}, ну что, начнём.`;
  let base = "Остальное узнаю по ходу. Каждая пробежка расскажет мне о тебе чуть больше.";
  if (a.cycle === "on") base += " А в тяжёлые дни буду бережнее, без гонки.";
  if (a.proactive === "yes") base += " Иногда напишу сама, только когда правда есть повод.";
  else if (a.proactive === "no") base += " Первый шаг оставляю за тобой.";
  return [opening, base];
}
const ACCENT_LINE = "Я рядом.";

// Подписи значений для рекапа.
const GENDER_WORD: Record<string, string> = { male: "он", female: "она", neutral: "без рода" };
const CYCLE_WORD: Record<string, string> = { on: "учитываю", self: "по запросу", off: "не учитываю" };
const PROACTIVE_WORD: Record<string, string> = { yes: "пишу первой", no: "жду тебя" };
const FIELD_LABEL: Record<string, string> = {
  name: "обращение",
  gender: "род",
  cycle: "цикл",
  proactive: "пишу первой",
};

// ─── типы ленты ────────────────────────────────────────────────────────────

type MsgSide = "nika" | "user" | "skip" | "accent";
interface Msg {
  id: number;
  side: MsgSide;
  /** Спец-значение TYPING рисует «печатает…». */
  text: string;
  /** Реплики финала — пересобираются при правке рекапа. */
  final?: boolean;
}
const TYPING = " typing";

const EMPTY: Answers = { name: "", gender: "", cycle: "", proactive: "" };

// Переиспользуемые классы на дизайн-токенах.
const FIELD_INPUT =
  "min-w-0 flex-1 rounded-pill border-[1.5px] border-line-default bg-surface-nika px-[18px] py-3 text-[16px] text-ink-primary outline-none transition-colors placeholder:text-ink-muted focus:border-accent";
const SEND_BTN =
  "flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-full bg-ink-primary text-canvas transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30";
function chipCls(sel: boolean) {
  return cn(
    "rounded-pill border-[1.5px] px-[17px] py-[11px] text-[14.5px] transition-colors",
    sel
      ? "border-accent bg-accent text-white"
      : "border-line-default bg-elevated text-ink-primary hover:border-accent hover:text-accent",
  );
}

// ─── prefers-reduced-motion ───────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

// ─── презентационные части ────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex gap-1 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rounded-full bg-ink-faint motion-safe:animate-blink"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

function ProgressDots({ idx, hidden }: { idx: number; hidden: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5", hidden && "invisible")} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-300",
            i === idx
              ? "h-1.5 w-4 bg-accent"
              : i < idx
                ? "h-1.5 w-1.5 bg-ink-faint"
                : "h-1.5 w-1.5 bg-line-strong",
          )}
        />
      ))}
    </div>
  );
}

function DesktopStepper({ idx, done }: { idx: number; done: boolean }) {
  return (
    <div className="mt-auto flex flex-col gap-px" aria-hidden>
      {STEPPER_LABELS.map((label, i) => {
        const cur = i === idx;
        const complete = done || i < idx;
        return (
          <div
            key={label}
            className={cn(
              "flex items-center gap-3 py-2 text-sm transition-colors",
              cur ? "text-ink-primary" : complete ? "text-ink-secondary" : "text-ink-muted",
            )}
          >
            <span
              className={cn(
                "flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] transition-colors",
                cur
                  ? "border-accent bg-accent text-white"
                  : complete
                    ? "border-accent-soft bg-accent-soft text-accent-deep"
                    : "border-line-strong",
              )}
            >
              {i + 1}
            </span>
            {label}
          </div>
        );
      })}
    </div>
  );
}

function Avatar({ size = 34 }: { size?: number }) {
  return (
    <span
      className="flex-shrink-0 rounded-full bg-nika-avatar"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

// Карточка-рекап «что я запомнила».
function Recap({
  answers,
  editing,
  onEdit,
}: {
  answers: Answers;
  editing: keyof Answers | null;
  onEdit: (f: keyof Answers) => void;
}) {
  const rows: { field: keyof Answers; label: string; value: string }[] = [
    { field: "name", label: FIELD_LABEL.name, value: answers.name || "—" },
    { field: "gender", label: FIELD_LABEL.gender, value: GENDER_WORD[answers.gender] ?? "—" },
  ];
  if (answers.gender === "female") {
    rows.push({ field: "cycle", label: FIELD_LABEL.cycle, value: CYCLE_WORD[answers.cycle] ?? "—" });
  }
  rows.push({ field: "proactive", label: FIELD_LABEL.proactive, value: PROACTIVE_WORD[answers.proactive] ?? "—" });

  return (
    <div className="animate-fade-in self-stretch rounded-card border border-line-default bg-elevated p-1.5">
      <div className="px-3 pb-1.5 pt-2 font-mono text-[9.5px] uppercase tracking-[0.15em] text-ink-faint">
        что я запомнила · нажми, чтобы изменить
      </div>
      {rows.map((r) => (
        <button
          key={r.field}
          type="button"
          onClick={() => onEdit(r.field)}
          className={cn(
            "flex w-full items-center justify-between rounded-[11px] px-3 py-2.5 text-left transition-colors hover:bg-surface-nika",
            editing === r.field && "bg-surface-nika",
          )}
        >
          <span className="text-[13px] text-ink-muted">{r.label}</span>
          <span className="flex items-center gap-2 text-[14px] text-ink-primary">
            {r.value}
            <span className="text-[11px] text-ink-faint">изменить</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── основной компонент ───────────────────────────────────────────────────────

export function ChatOnboarding({ userId }: { userId: string }) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [stepId, setStepId] = useState<StepId>("intro");
  const [feed, setFeed] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  // Финал: правка рекапа, сохранение.
  const [editingField, setEditingField] = useState<keyof Answers | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Рефы для доступа к свежим значениям из async-последовательностей.
  const answersRef = useRef<Answers>(EMPTY);
  const busyRef = useRef(false);
  const genRef = useRef(0); // токен последовательности: инвалидирует устаревшую анимацию
  const msgIdRef = useRef(0);
  const notifPermissionRef = useRef<NotifPermission | null>(null); // уйдёт в профиль
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const didInit = useRef(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Показывает баннер-превью и прячет его через 5 c.
  const showBanner = useCallback((text: string) => {
    setBanner(text);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }, []);
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  const setBusyBoth = useCallback((v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  }, []);

  const wait = useCallback(
    (ms: number) => new Promise<void>((r) => setTimeout(r, reduced ? 0 : ms)),
    [reduced],
  );

  const nextMsgId = () => ++msgIdRef.current;

  // Автоскролл ленты вниз при изменениях.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [feed, reduced]);

  // Сохранение профиля (upsert). Возвращает текст ошибки или null.
  const persist = useCallback(
    async (a: Answers): Promise<string | null> => {
      if (!a.gender) return null;
      return saveOnboarding(supabase, userId, {
        name: a.name,
        gender: a.gender,
        cycle: a.cycle || null,
        proactive: a.proactive === "yes" ? true : a.proactive === "no" ? false : null,
        notifPermission: notifPermissionRef.current,
      });
    },
    [supabase, userId],
  );

  // Реплики финала (прощание + акцент) как элементы ленты с флагом final.
  const farewellMsgs = useCallback((a: Answers): Msg[] => {
    const msgs: Msg[] = farewell(a).map((text) => ({ id: nextMsgId(), side: "nika" as MsgSide, text, final: true }));
    msgs.push({ id: nextMsgId(), side: "accent", text: ACCENT_LINE, final: true });
    return msgs;
  }, []);

  // ── анимация реплик Ники ──────────────────────────────────────────────────
  const nikaType = useCallback(
    async (lines: string[], token: number, markFinal = false) => {
      for (const line of lines) {
        if (token !== genRef.current) return;
        const id = nextMsgId();
        setFeed((f) => [...f, { id, side: "nika", text: TYPING, final: markFinal }]);
        await wait(560 + Math.min(line.length * 9, 520));
        if (token !== genRef.current) return;
        setFeed((f) => f.map((m) => (m.id === id ? { ...m, text: line } : m)));
        await wait(160);
      }
    },
    [wait],
  );

  // ── статическая пересборка пройденных шагов (для «Назад») ──────────────────
  const buildStaticFeed = useCallback((target: StepId, a: Answers): Msg[] => {
    const out: Msg[] = [];
    const push = (side: MsgSide, text: string) => out.push({ id: nextMsgId(), side, text });
    const p = plan(a);
    const upto = p.indexOf(target);

    for (let i = 0; i < upto; i++) {
      const id = p[i];
      if (id === "final") continue;
      const s = STEP[id];
      s.nika.forEach((l) => push("nika", l));
      if (!s.field || id === "intro") continue;
      const v = a[s.field];
      if (v === "" && s.optional) {
        push("skip", "пропустить");
        push("nika", "Хорошо, пропустим.");
        continue;
      }
      if (v === "") continue;
      const label = s.chips?.find((o) => o.value === v)?.label ?? v;
      push("user", label);
      push("nika", s.ack(v));
    }

    // Текущий (целевой) шаг: реплики Ники мгновенно, без печати.
    if (target !== "final") STEP[target].nika.forEach((l) => push("nika", l));
    return out;
  }, []);

  // ── переход на шаг ─────────────────────────────────────────────────────────
  const enter = useCallback(
    async (id: StepId, mode: "forward" | "rebuild") => {
      const token = ++genRef.current;
      setStepId(id);
      if (id === "name") setNameDraft(answersRef.current.name);

      if (id === "final") {
        // Финал: прощание по роду + акцент, затем сохранение.
        setBusyBoth(true);
        await nikaType(farewell(answersRef.current), token, true);
        if (token !== genRef.current) return;
        setFeed((f) => [...f, { id: nextMsgId(), side: "accent", text: ACCENT_LINE, final: true }]);
        const err = await persist(answersRef.current);
        if (token !== genRef.current) return;
        setSaveError(err ? "Не получилось сохранить. Попробуй ещё раз." : null);
        setBusyBoth(false);
        return;
      }

      if (mode === "rebuild") {
        setFeed(buildStaticFeed(id, answersRef.current));
        setBusyBoth(false);
      } else {
        setBusyBoth(true);
        await nikaType(STEP[id].nika, token);
        if (token === genRef.current) setBusyBoth(false);
      }
    },
    [nikaType, buildStaticFeed, setBusyBoth, persist],
  );

  // ── ответ пользователя → ack → следующий шаг ───────────────────────────────
  const advanceFrom = useCallback(
    async (id: StepId, value: string, label: string | null, skip = false) => {
      if (busyRef.current) return;
      const token = ++genRef.current;
      setBusyBoth(true);

      const field = id !== "final" ? STEP[id].field : undefined;
      let updated = answersRef.current;

      if (field && id !== "intro") {
        updated = { ...updated, [field]: value };
        answersRef.current = updated;
        setAnswers(updated);
        setFeed((f) => [
          ...f,
          { id: nextMsgId(), side: skip ? "skip" : "user", text: skip ? "пропустить" : label ?? "" },
        ]);

        if (id === "proactive" && value === "yes") {
          // Единственная реально работающая интеграция: системный запрос
          // разрешения на уведомления, ack по результату и превью-баннер.
          const res = await requestNotifPermission();
          if (token !== genRef.current) return;
          notifPermissionRef.current = res;
          await nikaType([permissionAck(res)], token);
          if (token !== genRef.current) return;
          await nikaType(["Например, вот так это будет выглядеть:"], token);
          if (token !== genRef.current) return;
          if (res === "granted") tryOsNotification(SAMPLE_PUSH);
          showBanner(SAMPLE_PUSH);
        } else {
          const ackText = skip ? "Хорошо, пропустим." : STEP[id as Exclude<StepId, "final">].ack(value);
          await nikaType([ackText], token);
          if (token !== genRef.current) return;
        }
      }

      const next = nextOf(id, updated);
      setBusyBoth(false);
      if (next) enter(next, "forward");
    },
    [nikaType, enter, setBusyBoth, showBanner],
  );

  const back = useCallback(() => {
    if (busyRef.current) return;
    const prev = prevOf(stepId, answersRef.current);
    if (!prev) return;
    enter(prev, "rebuild");
  }, [stepId, enter]);

  // Открыть правку строки рекапа.
  const openEdit = useCallback((f: keyof Answers) => {
    if (f === "name") setNameDraft(answersRef.current.name);
    setEditingField(f);
  }, []);

  // Применить правку рекапа: пересобрать прощание, сохранить.
  const applyEdit = useCallback(
    (field: keyof Answers, value: string) => {
      let na: Answers = { ...answersRef.current, [field]: value };
      // Смена рода не на женский убирает цикл (строка исчезает из рекапа).
      if (field === "gender" && value !== "female") na = { ...na, cycle: "" };
      answersRef.current = na;
      setAnswers(na);
      setFeed((f) => [...f.filter((m) => !m.final), ...farewellMsgs(na)]);
      setEditingField(null);
      persist(na).then((err) => setSaveError(err ? "Не получилось сохранить. Попробуй ещё раз." : null));
    },
    [farewellMsgs, persist],
  );

  // «Поговорить с Никой»: досохранить и уйти в приложение.
  const talk = useCallback(async () => {
    setSaving(true);
    const err = await persist(answersRef.current);
    if (err) {
      setSaveError("Не получилось сохранить. Попробуй ещё раз.");
      setSaving(false);
      return;
    }
    router.push("/day1");
    router.refresh();
  }, [persist, router]);

  const restart = useCallback(() => {
    genRef.current++;
    answersRef.current = EMPTY;
    notifPermissionRef.current = null;
    setAnswers(EMPTY);
    setNameDraft("");
    setFeed([]);
    setEditingField(null);
    setSaveError(null);
    setSaving(false);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(null);
    enter("intro", "forward");
  }, [enter]);

  // ── старт ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    enter("intro", "forward");
  }, [enter]);

  // ── производные для шапки/степпера ─────────────────────────────────────────
  const chromeHidden = stepId === "intro" || stepId === "final";
  const dotIdx = stepId === "final" ? -1 : (STEP[stepId].dot ?? -1);
  const stepperDone = stepId === "final";
  const canBack = !busy && !chromeHidden && !!prevOf(stepId, answers);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-dvh w-full bg-canvas-outer">
      {/* Брендпанель (десктоп) */}
      <aside
        className="hidden w-[42%] max-w-[430px] flex-col gap-6 border-r border-line-default p-12 lg:flex"
        style={{
          backgroundImage: "linear-gradient(158deg, var(--surface-warm), var(--surface-deep))",
        }}
      >
        <Avatar size={56} />
        <div>
          <div className="font-serif text-[40px] font-medium leading-none tracking-[0.01em] text-ink-primary">
            НИКА
          </div>
          <p className="mt-3.5 max-w-[270px] text-[15px] leading-[1.55] text-ink-secondary">
            Не тренер и не план. Просто <em className="font-serif italic text-accent">рядом</em>, пока ты бежишь.
          </p>
        </div>
        <DesktopStepper idx={dotIdx} done={stepperDone} />
      </aside>

      {/* Колонка чата */}
      <div className="flex min-h-dvh flex-1 flex-col bg-canvas">
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
          {/* Баннер-превью уведомления (внутри экрана) */}
          {banner && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-40 animate-fade-in">
              <div className="flex items-start gap-2.5 rounded-[18px] border border-line-default bg-elevated px-3.5 py-3 shadow-card">
                <span className="h-8 w-8 flex-shrink-0 rounded-[9px] bg-nika-avatar" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-ink-primary">Ника</span>
                    <span className="text-[10.5px] text-ink-muted">сейчас</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-ink-secondary">{banner}</div>
                </div>
              </div>
            </div>
          )}

          {/* Шапка */}
          <header className="flex items-center gap-3 border-b border-line-subtle px-5 pb-3.5 pt-6">
            <button
              type="button"
              onClick={back}
              aria-label="Назад"
              className={cn(
                "flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-nika hover:text-ink-primary",
                canBack ? "flex" : "invisible",
              )}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <Avatar />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-serif text-[16px] font-medium tracking-[0.01em] text-ink-primary">НИКА</div>
              <div className={cn("mt-0.5 text-[11.5px]", busy ? "text-accent" : "text-ink-muted")}>
                {busy ? "печатает…" : "рядом"}
              </div>
            </div>
            <ProgressDots idx={dotIdx} hidden={chromeHidden} />
          </header>

          {/* Скрытый прогресс для скринридеров */}
          <span className="sr-only" aria-live="polite">
            {chromeHidden ? "" : `Шаг ${dotIdx + 1} из 3`}
          </span>

          {/* Лента */}
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-6">
            {feed.map((m) => {
              if (m.side === "skip") {
                return (
                  <div key={m.id} className="flex animate-fade-in justify-end">
                    <div className="rounded-bubble rounded-br-[6px] border border-dashed border-line-strong px-3.5 py-2.5 text-[13px] text-ink-muted">
                      пропустить
                    </div>
                  </div>
                );
              }
              if (m.side === "user") {
                return (
                  <div key={m.id} className="flex animate-fade-in justify-end">
                    <div className="max-w-[82%] rounded-bubble rounded-br-[6px] bg-bubble-bg px-4 py-3 text-[15px] leading-[1.45] text-bubble-fg">
                      {m.text}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex animate-fade-in justify-start">
                  <div className="max-w-[82%] rounded-bubble rounded-bl-[6px] border border-line-subtle bg-surface-nika px-4 py-3 text-[15px] leading-[1.45] text-ink-primary">
                    {m.side === "accent" ? (
                      <span className="font-serif text-[18px] font-light italic tracking-[-0.01em] text-accent">{m.text}</span>
                    ) : m.text === TYPING ? (
                      <TypingDots />
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              );
            })}

            {stepId === "final" && !busy && (
              <Recap answers={answers} editing={editingField} onEdit={openEdit} />
            )}

            <div ref={feedEndRef} />
          </div>

          {/* Док управления */}
          <div className="min-h-[82px] border-t border-line-subtle px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3.5">
            {!busy && (
              <Dock
                stepId={stepId}
                answers={answers}
                nameDraft={nameDraft}
                setNameDraft={setNameDraft}
                advanceFrom={advanceFrom}
                restart={restart}
                editingField={editingField}
                setEditingField={setEditingField}
                applyEdit={applyEdit}
                onTalk={talk}
                saving={saving}
                saveError={saveError}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── док: интро / ввод имени / чипы / финал (кнопки + инлайн-правка) ───────────

interface DockProps {
  stepId: StepId;
  answers: Answers;
  nameDraft: string;
  setNameDraft: (v: string) => void;
  advanceFrom: (id: StepId, value: string, label: string | null, skip?: boolean) => void;
  restart: () => void;
  editingField: keyof Answers | null;
  setEditingField: (f: keyof Answers | null) => void;
  applyEdit: (field: keyof Answers, value: string) => void;
  onTalk: () => void;
  saving: boolean;
  saveError: string | null;
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 9h11M9 4l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dock({
  stepId,
  answers,
  nameDraft,
  setNameDraft,
  advanceFrom,
  restart,
  editingField,
  setEditingField,
  applyEdit,
  onTalk,
  saving,
  saveError,
}: DockProps) {
  if (stepId === "intro") {
    return (
      <button
        type="button"
        onClick={() => advanceFrom("intro", "", "")}
        className="flex h-[52px] w-full items-center justify-center rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        Познакомимся
      </button>
    );
  }

  if (stepId === "final") {
    // Инлайн-правка строки рекапа.
    if (editingField) {
      const f = editingField;
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            <span>изменить · {FIELD_LABEL[f]}</span>
            <button
              type="button"
              onClick={() => setEditingField(null)}
              className="font-sans text-[12.5px] normal-case tracking-normal text-ink-muted transition-colors hover:text-accent"
            >
              Отмена
            </button>
          </div>

          {f === "name" ? (
            <div className="flex items-center gap-2.5">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nameDraft.trim().length >= 2 && applyEdit("name", nameDraft.trim())}
                aria-label="Имя"
                autoFocus
                className={FIELD_INPUT}
              />
              <button
                type="button"
                onClick={() => nameDraft.trim().length >= 2 && applyEdit("name", nameDraft.trim())}
                disabled={nameDraft.trim().length < 2}
                aria-label="Сохранить"
                className={SEND_BTN}
              >
                <SendIcon />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {STEP[f].chips?.map((o) => (
                <button key={o.value} type="button" onClick={() => applyEdit(f, o.value)} className={chipCls(answers[f] === o.value)}>
                  {o.label}
                </button>
              ))}
              {f === "cycle" && (
                <button type="button" onClick={() => applyEdit("cycle", "")} className={chipCls(answers.cycle === "")}>
                  Убрать
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2.5">
        {saveError && <p className="text-center text-[13px] text-accent">{saveError}</p>}
        <button
          type="button"
          onClick={onTalk}
          disabled={saving}
          className="flex h-[52px] w-full items-center justify-center rounded-pill bg-accent text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Сохраняем…" : "Поговорить с Никой"}
        </button>
        <button
          type="button"
          onClick={restart}
          className="mx-auto block py-1 text-[12.5px] text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent"
        >
          Пройти заново
        </button>
      </div>
    );
  }

  const s = STEP[stepId];

  if (s.input) {
    const ok = nameDraft.trim().length >= s.input.minLen;
    const submit = () => ok && advanceFrom(stepId, nameDraft.trim(), nameDraft.trim());
    return (
      <div className="flex items-center gap-2.5">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={s.input.placeholder}
          aria-label={s.input.placeholder}
          autoFocus
          className={FIELD_INPUT}
        />
        <button type="button" onClick={submit} disabled={!ok} aria-label="Отправить" className={SEND_BTN}>
          <SendIcon />
        </button>
      </div>
    );
  }

  // Чипы (gender / cycle / proactive)
  return (
    <div className="flex flex-col gap-2.5">
      {s.note && <p className="text-[11.5px] leading-snug text-ink-muted">· {s.note}</p>}
      <div className="flex flex-wrap gap-2.5">
        {s.chips?.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => advanceFrom(stepId, o.value, o.label)}
            className={chipCls(s.field ? answers[s.field] === o.value : false)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {s.optional && (
        <button
          type="button"
          onClick={() => advanceFrom(stepId, "", null, true)}
          className="self-start py-0.5 text-[12.5px] text-ink-muted underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-accent"
        >
          Пропустить
        </button>
      )}
    </div>
  );
}
