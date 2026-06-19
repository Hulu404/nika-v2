"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@/lib/supabase";
import { PageTransition } from "@/components/PageTransition";
import { cn } from "@/lib/utils";

type Mode = "signup" | "signin";

/** Человекочитаемые сообщения по кодам/тексту ошибок Supabase Auth. */
function authErrorMessage(err: { code?: string; message?: string }): string {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "user_already_exists" || /already registered/i.test(msg))
    return "Этот email уже зарегистрирован — войди вместо регистрации.";
  // Пароль найден в утечках (HIBP) или признан слишком простым.
  if (/breach|pwned|leaked|easy to guess|known to be weak/i.test(msg))
    return "Этот пароль встречался в утечках или слишком простой — выбери другой.";
  // Не выполнены требования по составу (буквы/цифры/спецсимволы).
  if (/each of the following|should contain/i.test(msg))
    return "Пароль должен содержать буквы и цифры.";
  if (code === "weak_password" || /at least|too short/i.test(msg))
    return "Пароль слишком короткий — нужно минимум 8 символов.";
  if (code === "invalid_credentials" || /invalid login/i.test(msg))
    return "Неверный email или пароль.";
  if (code === "email_address_invalid" || code === "validation_failed")
    return "Проверь, правильно ли введён email.";
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(msg))
    return "Слишком много попыток. Подожди минуту и попробуй снова.";
  return "Что-то пошло не так. Попробуй ещё раз.";
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pwScore(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Za-zА-Яа-я]/.test(p) && /\d/.test(p)) s++;
  if (p.length >= 12 || /[^A-Za-z0-9]/.test(p)) s++;
  return p.length ? s : 0;
}

const STRENGTH_COLORS = ["bg-accent", "bg-[#D08A3E]", "bg-[#7BA968]"];

export default function AuthPage() {
  const [supabase] = useState(() => createClientComponentClient());

  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPw, setTouchedPw] = useState(false);

  // Тема — синхронизируем с глобальным механизмом приложения (класс .dark + nika-theme).
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));

    // Ошибки из /auth/callback (неудачное подтверждение по ссылке из письма).
    const e = new URLSearchParams(window.location.search).get("error");
    if (e === "auth") {
      setError("Ссылка подтверждения недействительна или открыта в другом браузере. Войди по почте и паролю.");
    } else if (e === "missing_code") {
      setError("Ссылка подтверждения неполная. Войди по почте и паролю.");
    }
  }, []);
  function applyTheme(next: "light" | "dark") {
    const d = next === "dark";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("nika-theme", next);
  }

  const emailOk = emailRe.test(email.trim());
  const pwOk = mode === "signup" ? password.length >= 8 : password.length >= 1;
  const canSubmit = emailOk && pwOk && !loading;

  const emailErr = touchedEmail && email.trim() !== "" && !emailOk;
  const pwErr = touchedPw && mode === "signup" && password !== "" && password.length < 8;
  const pwTooShort = password.length > 0 && password.length < 8;
  const score = pwScore(password);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setTouchedEmail(false);
    setTouchedPw(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    if (mode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setLoading(false);
        setError(authErrorMessage(err));
        return;
      }
      // Жёсткий переход: полная перезагрузка гарантирует, что сервер увидит
      // свежий cookie сессии (мягкая навигация ловит гонку и кидает на /auth).
      window.location.assign("/day1");
      return;
    }

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    if (err) {
      setLoading(false);
      setError(authErrorMessage(err));
      return;
    }
    if (data.session) {
      // Сессия сразу (Confirm email выключен) — ведём на онбординг.
      window.location.assign("/onboarding");
      return;
    }
    // Нет сессии = включён «Confirm email» — письмо ушло на почту.
    setLoading(false);
    setInfo("Мы отправили письмо для подтверждения — проверь почту и перейди по ссылке.");
  }

  return (
    <PageTransition>
      <div
        className="relative min-h-dvh w-full"
        style={{
          backgroundColor: "var(--bg-canvas)",
          backgroundImage:
            "radial-gradient(circle at 18% -5%, rgba(200,85,61,0.06), transparent 38%), radial-gradient(circle at 85% 105%, rgba(31,27,22,0.05), transparent 42%)",
        }}
      >
        {/* Переключатель темы */}
        <div
          role="group"
          aria-label="Тема оформления"
          className="fixed right-3.5 top-3.5 z-20 inline-flex rounded-pill border border-line-default bg-elevated p-[3px] shadow-card"
        >
          {(["light", "dark"] as const).map((t) => {
            const active = (t === "dark") === dark;
            return (
              <button
                key={t}
                type="button"
                onClick={() => applyTheme(t)}
                aria-pressed={active}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active ? "bg-ink-primary text-canvas" : "text-ink-muted",
                )}
              >
                {t === "light" ? "Светлая" : "Тёмная"}
              </button>
            );
          })}
        </div>

        <div className="mx-auto flex min-h-dvh max-w-[460px] flex-col justify-center gap-4 px-4 pb-7 pt-5 lg:max-w-none lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
          {/* Брендовое полотно / шапка */}
          <aside
            className="relative flex flex-col gap-[18px] overflow-hidden rounded-card p-[22px] lg:w-[46%] lg:gap-0 lg:rounded-none lg:p-14"
            style={{
              backgroundImage:
                "radial-gradient(circle at 100% 100%, rgba(200,85,61,0.18), transparent 55%), linear-gradient(160deg, var(--surface-warm), var(--surface-deep))",
            }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-[34px] w-[34px] flex-shrink-0 rounded-full"
                style={{ background: "linear-gradient(135deg, #F4E4D6 0%, #E8B7A8 55%, #C8553D 130%)" }}
                aria-hidden
              />
              <span className="font-serif text-[26px] font-medium tracking-[-0.01em] text-ink-primary">НИКА</span>
            </div>
            <div className="lg:my-auto">
              <h2 className="font-serif text-[24px] font-normal leading-[1.28] tracking-[-0.015em] text-ink-primary lg:text-[34px]">
                Я не тренер. Не план.
                <br />
                Я рядом — <em className="italic text-accent">чтобы ты не бросил</em>.
              </h2>
              <p className="mt-3 max-w-[34ch] text-[13px] leading-[1.5] text-ink-secondary lg:mt-[18px]">
                Ментальный спутник для бегунов-любителей. Текстовый диалог — никаких таблиц и графиков.
              </p>
            </div>
          </aside>

          {/* Форма */}
          <section className="lg:flex lg:flex-1 lg:items-center lg:justify-center lg:p-10">
            <div className="rounded-card border border-line-subtle bg-canvas px-[22px] pb-[26px] pt-6 shadow-card lg:w-full lg:max-w-[420px] lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              {/* Переключатель режима (мобильный) */}
              <div className="relative mb-[22px] grid grid-cols-2 rounded-pill bg-surface-nika p-1 lg:hidden">
                <span
                  aria-hidden
                  className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-pill bg-ink-primary transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]"
                  style={{ transform: mode === "signin" ? "translateX(100%)" : "translateX(0)" }}
                />
                {(["signup", "signin"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      "relative z-10 rounded-pill py-[9px] text-[13.5px] font-medium transition-colors",
                      mode === m ? "text-canvas" : "text-ink-secondary",
                    )}
                  >
                    {m === "signup" ? "Регистрация" : "Вход"}
                  </button>
                ))}
              </div>

              <h1 className="font-serif text-[27px] font-normal leading-[1.2] tracking-[-0.02em] text-ink-primary lg:text-[30px]">
                {mode === "signup" ? (
                  <>
                    Заведём место <em className="italic text-accent">для нас двоих</em>
                  </>
                ) : (
                  "С возвращением."
                )}
              </h1>
              <p className="mb-[22px] mt-2.5 text-[14px] leading-[1.5] text-ink-secondary">
                {mode === "signup"
                  ? "Нужны только почта и пароль. Меньше минуты."
                  : "Войди — я помню, на чём мы остановились."}
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                {/* Почта */}
                <div>
                  <label htmlFor="email" className="mb-[7px] block text-[12px] font-medium text-ink-secondary">
                    Почта
                  </label>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-input border-[1.5px] bg-elevated px-3.5 transition-all focus-within:border-ink-primary focus-within:shadow-[0_0_0_3px_rgba(31,27,22,0.05)]",
                      emailErr ? "border-accent" : "border-line-default",
                    )}
                  >
                    <span className="flex text-ink-muted" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" />
                        <path d="M3 6l7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="ты@почта.рф"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError(null);
                      }}
                      onBlur={() => setTouchedEmail(true)}
                      disabled={loading}
                      className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-ink-primary outline-none placeholder:text-ink-muted disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Пароль */}
                <div>
                  <label htmlFor="password" className="mb-[7px] block text-[12px] font-medium text-ink-secondary">
                    Пароль
                  </label>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-input border-[1.5px] bg-elevated px-3.5 transition-all focus-within:border-ink-primary focus-within:shadow-[0_0_0_3px_rgba(31,27,22,0.05)]",
                      pwErr ? "border-accent" : "border-line-default",
                    )}
                  >
                    <span className="flex text-ink-muted" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="4" y="9" width="12" height="8" rx="2" />
                        <path d="M7 9V7a3 3 0 0 1 6 0v2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <input
                      id="password"
                      type={showPw ? "text" : "password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      placeholder="минимум 8 символов"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      onBlur={() => setTouchedPw(true)}
                      disabled={loading}
                      className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-ink-primary outline-none placeholder:text-ink-muted disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                      className="flex rounded-lg p-1 text-ink-muted transition-colors hover:text-ink-secondary"
                    >
                      {showPw ? (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 3l14 14" strokeLinecap="round" />
                          <path d="M8.2 8.2a2.5 2.5 0 0 0 3.5 3.5" strokeLinecap="round" />
                          <path d="M6 6.4C3.7 7.8 1.5 10 1.5 10S4.5 15.5 10 15.5c1.3 0 2.5-.3 3.6-.8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M9 4.6c.33-.07.66-.1 1-.1 5.5 0 8.5 5.5 8.5 5.5s-.8 1.45-2.2 2.9" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="10" cy="10" r="2.5" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Сила пароля + подсказка (только регистрация) */}
                  {mode === "signup" && (
                    <div className="mt-2.5">
                      <div className="flex gap-1.5" aria-hidden>
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              "h-1 flex-1 rounded-pill transition-colors duration-200",
                              i < score ? STRENGTH_COLORS[i] : "bg-line-default",
                            )}
                          />
                        ))}
                      </div>
                      <p className={cn("mt-2 text-[12px] leading-[1.4]", pwTooShort ? "text-accent" : "text-ink-muted")}>
                        {pwTooShort ? "Минимум 8 символов." : "Надёжный пароль защитит твои разговоры."}
                      </p>
                    </div>
                  )}
                </div>

                {/* Юридическая строка (только регистрация) */}
                {mode === "signup" && (
                  <p className="text-[11.5px] leading-[1.5] text-ink-muted">
                    Создавая аккаунт, ты соглашаешься с{" "}
                    <a href="#" className="text-ink-secondary underline underline-offset-2">условиями</a> и{" "}
                    <a href="#" className="text-ink-secondary underline underline-offset-2">политикой приватности</a>.
                  </p>
                )}

                {/* Сообщения */}
                {error && <p className="text-center text-[13px] leading-relaxed text-accent">{error}</p>}
                {info && <p className="text-center text-[13px] leading-relaxed text-ink-secondary">{info}</p>}

                {/* Кнопка */}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cn(
                    "group mt-1 flex h-[54px] items-center justify-center gap-2 rounded-pill text-[15px] font-medium text-canvas transition-colors",
                    canSubmit ? "bg-ink-primary hover:bg-accent" : "cursor-not-allowed bg-ink-faint",
                  )}
                >
                  {loading ? (
                    mode === "signup" ? "Создаём аккаунт…" : "Входим…"
                  ) : (
                    <>
                      {mode === "signup" ? "Создать аккаунт" : "Войти"}
                      <span className="transition-transform duration-200 group-hover:translate-x-[3px]" aria-hidden>
                        →
                      </span>
                    </>
                  )}
                </button>
              </form>

              {/* Альт-строка (десктоп) */}
              <p className="mt-5 hidden text-[13.5px] text-ink-secondary lg:block">
                {mode === "signup" ? "Уже со мной? " : "Впервые здесь? "}
                <button
                  type="button"
                  onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  {mode === "signup" ? "Войти" : "Создать аккаунт"}
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>
    </PageTransition>
  );
}
