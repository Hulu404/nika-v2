"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";
import { BottomSheet } from "@/components/BottomSheet";

// ─── типы ────────────────────────────────────────────────────────────────────

type Tone = "soft" | "direct" | "brief";
type WhenWrite = "morning" | "evening" | "never";
type SheetId =
  | "tone" | "when" | "scenarios" | "name"
  | "export" | "delete" | "how" | "manifesto" | "support" | "terms"
  | "privacy" | "oferta"
  | null;

// ─── константы ───────────────────────────────────────────────────────────────

const TONE_OPTIONS: { v: Tone; short: string; full: string; desc: string }[] = [
  { v: "soft",   short: "Тёплый",  full: "Мягко и бережно",   desc: "Как разговор с близким другом" },
  { v: "direct", short: "Прямой",  full: "Прямо и честно",    desc: "Без лишних слов" },
  { v: "brief",  short: "Краткий", full: "Коротко и по делу", desc: "Минимум текста" },
];

const WHEN_OPTIONS: { v: WhenWrite; short: string; full: string }[] = [
  { v: "morning", short: "Утром",     full: "Утром перед тренировкой" },
  { v: "evening", short: "Вечером",   full: "Вечером" },
  { v: "never",   short: "Не писать", full: "Не писать первой" },
];

// Первые N сценариев доступны на Free
const FREE_SCENARIOS = 2;

// ─── Skeleton UI ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
      {children}
    </p>
  );
}

interface RowProps {
  label: string;
  value?: string;
  badge?: string;
  red?: boolean;
  disabled?: boolean;
  tag?: string;
  onClick?: () => void;
  href?: string;
  rightEl?: React.ReactNode;
}

function Row({ label, value, badge, red, disabled, tag, onClick, href, rightEl }: RowProps) {
  const showChevron = (!!onClick || !!href) && !disabled && !rightEl;

  const inner = (
    <div className={cn("flex min-h-[52px] items-center gap-2.5 px-4 py-[13px]", disabled && "opacity-45")}>
      <span className={cn("flex-1 text-[15px] leading-snug", red ? "text-accent" : "text-ink-primary")}>
        {label}
      </span>
      {tag && (
        <span className="rounded-pill bg-surface-deep px-2.5 py-[3px] font-mono text-[9px] font-bold uppercase tracking-widest text-ink-muted">
          {tag}
        </span>
      )}
      {badge && (
        <span className="text-[13px] text-ink-muted">{badge}</span>
      )}
      {value && (
        <span className="max-w-[140px] truncate text-right text-[13px] text-ink-muted">{value}</span>
      )}
      {rightEl}
      {showChevron && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="flex-shrink-0 text-ink-faint">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );

  if (disabled) return inner;

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-surface-warm active:bg-surface-deep">
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className="w-full text-left transition-colors hover:bg-surface-warm active:bg-surface-deep">
        {inner}
      </button>
    );
  }

  return inner;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-[50px] flex-shrink-0 rounded-pill transition-colors duration-200",
        on ? "bg-accent" : "bg-line-default",
      )}
    >
      <span className={cn(
        "absolute left-0 top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-soft transition-transform duration-200",
        on ? "translate-x-[25px]" : "translate-x-[3px]",
      )} />
    </button>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "overflow-hidden rounded-card border border-line-default bg-elevated divide-y divide-line-subtle",
      className,
    )}>
      {children}
    </div>
  );
}

// ─── Pluraliser ───────────────────────────────────────────────────────────────

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  initialName: string;
  email: string;
  isPro: boolean;
  reminderEnabled: boolean;
  createdAt: string;
}

// ─── Основной компонент ───────────────────────────────────────────────────────

export function ProfileContent({
  userId,
  initialName,
  email,
  isPro,
  reminderEnabled,
  createdAt,
}: Props) {
  const [supabase] = useState(() => createClientComponentClient());

  // Preferences
  const [tone, setTone]         = useState<Tone>("soft");
  const [whenWrite, setWhenWrite] = useState<WhenWrite>(reminderEnabled ? "morning" : "never");
  const [dark, setDark]         = useState(false);

  // Name editing
  const [name, setName]         = useState(initialName);
  const [editName, setEditName] = useState(initialName);
  const [nameSaving, setNameSaving] = useState(false);

  // Active sheet
  const [activeSheet, setActiveSheet] = useState<SheetId>(null);
  const closeSheet = useCallback(() => setActiveSheet(null), []);

  // Days counter
  const daysWithNika = Math.max(1, Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
  ));

  // Read localStorage after mount
  useEffect(() => {
    const t = localStorage.getItem("nika-tone") as Tone | null;
    if (t) setTone(t);
    const w = localStorage.getItem("nika-when") as WhenWrite | null;
    if (w) setWhenWrite(w);
    const theme = localStorage.getItem("nika-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(theme === "dark" || (!theme && prefersDark));
  }, []);

  // ── Handlers ──

  function handleToneChange(v: Tone) {
    setTone(v);
    localStorage.setItem("nika-tone", v);
    closeSheet();
  }

  async function handleWhenChange(v: WhenWrite) {
    setWhenWrite(v);
    localStorage.setItem("nika-when", v);
    await supabase
      .from("profiles")
      .upsert({ user_id: userId, reminder_enabled: v !== "never" }, { onConflict: "user_id" });
    closeSheet();
  }

  function handleDarkToggle(v: boolean) {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("nika-theme", v ? "dark" : "light");
  }

  async function handleNameSave() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === name) { closeSheet(); return; }
    setNameSaving(true);
    await supabase.from("users").update({ display_name: trimmed }).eq("id", userId);
    setName(trimmed);
    setNameSaving(false);
    closeSheet();
  }

  async function handleDeleteConversations() {
    await supabase.from("conversations").delete().eq("user_id", userId);
    closeSheet();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  // Derived labels
  const toneShort       = TONE_OPTIONS.find(o => o.v === tone)?.short ?? "Тёплый";
  const whenShort       = WHEN_OPTIONS.find(o => o.v === whenWrite)?.short ?? "Утром";
  const scenariosLabel  = isPro ? "Все 5" : `${FREE_SCENARIOS} из 5 FREE`;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Scrollable page ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-32 pt-5">

          {/* Шапка */}
          <div className="mb-7 flex items-center gap-3">
            <Link
              href="/day1"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line-default bg-elevated text-ink-secondary transition-colors hover:text-ink-primary"
            >
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
                <path d="M10.5 3.5L6 8.5l4.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className="text-[22px] font-semibold leading-none text-ink-primary">Настройки</h1>
          </div>

          {/* Блок идентичности */}
          <div className="mb-6">
            <p className="font-serif text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
              {name || email.split("@")[0]}
            </p>
            <p className="mt-1 text-[14px] text-ink-muted">
              С НИКОЙ {daysWithNika} {pluralDays(daysWithNika)}
            </p>
          </div>

          {/* Карточка подписки (Free) */}
          {!isPro && (
            <div className="mb-6 rounded-card border border-line-default bg-elevated p-5">
              <span className="mb-3 inline-flex items-center rounded-pill border border-line-strong px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                Free
              </span>
              <p className="mb-2 text-[18px] font-semibold leading-snug text-ink-primary">
                Открой расширенную НИКУ
              </p>
              <p className="mb-4 text-[13px] leading-[1.6] text-ink-muted">
                Память диалогов · все 5 сценариев · аналитика по словам · без ограничений на сообщения
              </p>
              <p className="mb-4 font-mono text-[13px] text-ink-secondary">299 ₽/месяц</p>
              <Link
                href="/upgrade"
                className="block w-full rounded-pill bg-ink-primary py-[13px] text-center text-[14px] font-medium text-canvas transition-colors hover:bg-accent"
              >
                Попробовать 7 дней бесплатно
              </Link>
            </div>
          )}

          {/* Секция НИКА */}
          <div className="mb-5">
            <SectionLabel>НИКА</SectionLabel>
            <Card>
              <Row label="Тон общения"                     value={toneShort}       onClick={() => setActiveSheet("tone")} />
              <Row label="Сценарии"                        badge={scenariosLabel}  onClick={() => setActiveSheet("scenarios")} />
              <Row label="Когда писать первой"             value={whenShort}       onClick={() => setActiveSheet("when")} />
              <Row label="Имя — как ко мне обращаться"     value={name || "—"}     onClick={() => { setEditName(name); setActiveSheet("name"); }} />
            </Card>
          </div>

          {/* Секция Внешний вид */}
          <div className="mb-5">
            <SectionLabel>Внешний вид</SectionLabel>
            <Card>
              <Row
                label="Тёмная тема"
                rightEl={<Toggle on={dark} onChange={handleDarkToggle} />}
              />
            </Card>
          </div>

          {/* Секция Данные */}
          <div className="mb-5">
            <SectionLabel>Данные</SectionLabel>
            <Card>
              <Row label="Подключить Strava"  tag="скоро" disabled />
              <Row label="Подключить Garmin"  tag="скоро" disabled />
              <div className="px-4 py-3">
                <p className="text-[12px] leading-[1.55] text-ink-faint">
                  Появится после запуска. Пока НИКА работает по тому, что ты пишешь.
                </p>
              </div>
              <Row label="Экспорт диалогов"                onClick={() => setActiveSheet("export")} />
              <Row label="Удалить все диалоги" red          onClick={() => setActiveSheet("delete")} />
            </Card>
          </div>

          {/* Секция О НИКЕ */}
          <div className="mb-5">
            <SectionLabel>О НИКЕ</SectionLabel>
            <Card>
              <Row label="Как НИКА работает"   onClick={() => setActiveSheet("how")} />
              <Row label="Что НИКА не делает"  onClick={() => setActiveSheet("manifesto")} />
              <Row label="Поддержка"           onClick={() => setActiveSheet("support")} />
              <Row label="Условия и приватность"        onClick={() => setActiveSheet("terms")} />
              <Row label="Политика конфиденциальности" onClick={() => setActiveSheet("privacy")} />
              <Row label="Публичная оферта"            onClick={() => setActiveSheet("oferta")} />
            </Card>
          </div>

          {/* Выйти */}
          <button
            onClick={signOut}
            className="mb-4 w-full rounded-card border border-line-default bg-elevated py-[14px] text-[15px] font-medium text-accent transition-colors hover:bg-surface-warm"
          >
            Выйти
          </button>

          {/* Удалить аккаунт */}
          <button
            onClick={() => setActiveSheet("delete")}
            className="mb-8 w-full py-2 text-center text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
          >
            Удалить аккаунт
          </button>

          {/* Футер */}
          <p className="text-center font-mono text-[11px] tracking-wide text-ink-faint">
            v 1.0.0 · build 247
          </p>

        </div>
      </div>

      {/* ──────────────── BOTTOM SHEETS ──────────────────────────────────────── */}

      {/* Тон общения */}
      <BottomSheet isOpen={activeSheet === "tone"} onClose={closeSheet} title="Тон общения">
        <div className="flex flex-col gap-2.5">
          {TONE_OPTIONS.map((o) => {
            const active = tone === o.v;
            return (
              <button
                key={o.v}
                onClick={() => handleToneChange(o.v)}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] border px-4 py-4 text-left transition-all",
                  active
                    ? "border-ink-primary bg-ink-primary"
                    : "border-line-default bg-canvas hover:border-line-strong",
                )}
              >
                <div className="flex-1">
                  <p className={cn("text-[15px] font-medium", active ? "text-canvas" : "text-ink-primary")}>
                    {o.full}
                  </p>
                  <p className={cn("mt-0.5 text-[12px]", active ? "text-canvas/60" : "text-ink-muted")}>
                    {o.desc}
                  </p>
                </div>
                {active && (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="flex-shrink-0 text-canvas">
                    <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Когда писать первой */}
      <BottomSheet isOpen={activeSheet === "when"} onClose={closeSheet} title="Когда писать первой">
        <div className="flex flex-col gap-2.5">
          {WHEN_OPTIONS.map((o) => {
            const active = whenWrite === o.v;
            return (
              <button
                key={o.v}
                onClick={() => handleWhenChange(o.v)}
                className={cn(
                  "flex items-center justify-between rounded-[14px] border px-4 py-[14px] text-left transition-all",
                  active
                    ? "border-ink-primary bg-ink-primary"
                    : "border-line-default bg-canvas hover:border-line-strong",
                )}
              >
                <span className={cn("text-[15px] font-medium", active ? "text-canvas" : "text-ink-primary")}>
                  {o.full}
                </span>
                {active && (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="flex-shrink-0 text-canvas">
                    <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Сценарии */}
      <BottomSheet isOpen={activeSheet === "scenarios"} onClose={closeSheet} title="Сценарии">
        <div className="flex flex-col gap-2.5">
          {SCENARIO_ORDER.map((key, i) => {
            const meta = SCENARIO_META[key];
            const locked = !isPro && i >= FREE_SCENARIOS;
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] border px-4 py-4",
                  locked
                    ? "border-line-subtle bg-canvas/50 opacity-55"
                    : "border-line-default bg-canvas",
                )}
              >
                <div className="flex-1">
                  <p className={cn("text-[15px] font-medium", locked ? "text-ink-muted" : "text-ink-primary")}>
                    {meta.title}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">{meta.subtitle}</p>
                </div>
                {locked && (
                  <span className="flex-shrink-0 rounded-pill bg-surface-warm px-2.5 py-[3px] font-mono text-[9px] font-bold uppercase tracking-widest text-accent">
                    PRO
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {!isPro && (
          <Link
            href="/upgrade"
            onClick={closeSheet}
            className="mt-4 block w-full rounded-pill bg-accent py-[13px] text-center text-[14px] font-medium text-canvas transition-colors hover:bg-accent-deep"
          >
            Открыть все сценарии
          </Link>
        )}
      </BottomSheet>

      {/* Имя */}
      <BottomSheet isOpen={activeSheet === "name"} onClose={closeSheet} title="Как тебя называть">
        <div>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); }}
            placeholder="Твоё имя"
            autoFocus
            className="w-full rounded-[14px] border border-line-default bg-canvas px-4 py-[14px] text-[16px] text-ink-primary outline-none placeholder:text-ink-faint focus:border-accent transition-colors"
          />
          <button
            onClick={handleNameSave}
            disabled={nameSaving || !editName.trim()}
            className="mt-3 w-full rounded-pill bg-ink-primary py-[13px] text-[14px] font-medium text-canvas transition-colors hover:bg-accent disabled:opacity-50"
          >
            {nameSaving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </BottomSheet>

      {/* Экспорт диалогов */}
      <BottomSheet isOpen={activeSheet === "export"} onClose={closeSheet} title="Экспорт диалогов">
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-warm">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden className="text-ink-muted">
              <path d="M13 3v16M6 12l7 8 7-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 23h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-[18px] font-semibold text-ink-primary">Скоро</p>
          <p className="mt-2 max-w-[240px] text-[14px] leading-[1.6] text-ink-muted">
            Экспорт диалогов появится в следующем обновлении.
          </p>
        </div>
      </BottomSheet>

      {/* Удалить диалоги */}
      <BottomSheet isOpen={activeSheet === "delete"} onClose={closeSheet} title="Удалить все диалоги">
        <p className="mb-6 text-[14px] leading-[1.6] text-ink-secondary">
          Все диалоги с НИКОЙ будут удалены навсегда. Это действие нельзя отменить.
        </p>
        <button
          onClick={handleDeleteConversations}
          className="mb-3 w-full rounded-pill bg-accent py-[13px] text-[14px] font-medium text-canvas transition-colors hover:bg-accent-deep"
        >
          Удалить всё
        </button>
        <button
          onClick={closeSheet}
          className="w-full rounded-pill border border-line-default py-[13px] text-[14px] font-medium text-ink-secondary transition-colors hover:border-line-strong"
        >
          Отмена
        </button>
      </BottomSheet>

      {/* Как НИКА работает */}
      <BottomSheet isOpen={activeSheet === "how"} onClose={closeSheet} title="Как НИКА работает">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>НИКА — это не тренер и не психолог. Это собеседник, который помогает тебе не бросить бег.</p>
          <p>Каждый разговор строится вокруг твоего состояния прямо сейчас: устал, сорвался, не хочется — НИКА рядом.</p>
          <p>НИКА запоминает контекст в рамках одного диалога и предлагает нужный сценарий в зависимости от момента.</p>
          <p>Всё, что ты пишешь, — остаётся только в твоём профиле.</p>
        </div>
      </BottomSheet>

      {/* Что НИКА не делает */}
      <BottomSheet isOpen={activeSheet === "manifesto"} onClose={closeSheet} title="Что НИКА не делает">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>НИКА не даёт тренировочных планов и не считает километры вместо тебя.</p>
          <p>НИКА не заменяет врача, физиотерапевта или тренера.</p>
          <p>НИКА не отправляет уведомлений каждый день, если ты не просил.</p>
          <p>НИКА не оценивает твои результаты и не сравнивает тебя с другими.</p>
          <p className="text-ink-muted">Мы здесь только чтобы ты не бросил.</p>
        </div>
      </BottomSheet>

      {/* Поддержка */}
      <BottomSheet isOpen={activeSheet === "support"} onClose={closeSheet} title="Поддержка">
        <p className="mb-5 text-[14px] leading-[1.6] text-ink-secondary">
          Если что-то не работает или есть вопросы — напиши нам, мы читаем всё.
        </p>
        <a
          href="mailto:hello@nika-app.ru"
          className="flex items-center gap-3 rounded-[14px] border border-line-default bg-canvas px-4 py-4 transition-colors hover:border-accent/40"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="flex-shrink-0 text-ink-muted">
            <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2 6l7 5 7-5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <span className="flex-1 text-[15px] text-ink-primary">hello@nika-app.ru</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-faint">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </BottomSheet>

      {/* Условия и приватность */}
      <BottomSheet isOpen={activeSheet === "terms"} onClose={closeSheet} title="Условия и приватность">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>Твои данные хранятся на защищённых серверах и не передаются третьим лицам.</p>
          <p>Диалоги используются только для формирования ответов НИКИ в рамках твоей сессии.</p>
          <p>Ты можешь удалить все свои данные в любой момент в разделе «Данные».</p>
          <p>Оплата обрабатывается через ЮKassa. Отмена подписки — в любой момент из личного кабинета.</p>
        </div>
      </BottomSheet>

      {/* Политика конфиденциальности */}
      <BottomSheet isOpen={activeSheet === "privacy"} onClose={closeSheet} title="Политика конфиденциальности">
        <p className="mb-4 text-[13px] font-mono text-ink-faint">Документ в разработке</p>
        <p className="text-[14px] leading-[1.65] text-ink-secondary">
          Актуальная политика конфиденциальности появится до запуска.
          Мы обязуемся не передавать твои данные третьим лицам и использовать
          их только для работы сервиса.
        </p>
      </BottomSheet>

      {/* Публичная оферта */}
      <BottomSheet isOpen={activeSheet === "oferta"} onClose={closeSheet} title="Публичная оферта">
        <p className="mb-4 text-[13px] font-mono text-ink-faint">Документ в разработке</p>
        <p className="text-[14px] leading-[1.65] text-ink-secondary">
          Актуальная версия публичной оферты появится до запуска.
          Оферта будет регулировать условия предоставления платной подписки PRO.
        </p>
      </BottomSheet>
    </>
  );
}
