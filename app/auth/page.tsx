"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";

/** Человекочитаемые сообщения по кодам/тексту ошибок Supabase Auth. */
function authErrorMessage(err: { code?: string; message?: string }): string {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "user_already_exists" || /already registered/i.test(msg))
    return "Этот email уже зарегистрирован — войди вместо регистрации.";
  if (code === "weak_password" || /at least 6/i.test(msg))
    return "Пароль слишком короткий — нужно минимум 6 символов.";
  if (code === "invalid_credentials" || /invalid login/i.test(msg))
    return "Неверный email или пароль.";
  if (code === "email_address_invalid" || code === "validation_failed")
    return "Проверь, правильно ли введён email.";
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(msg))
    return "Слишком много попыток. Подожди минуту и попробуй снова.";
  return "Что-то пошло не так. Попробуй ещё раз.";
}

export default function AuthPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  function validate(): boolean {
    if (!email.trim() || !password) {
      setError("Введи email и пароль.");
      return false;
    }
    return true;
  }

  async function signIn() {
    if (!validate()) return;
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }

    router.push("/day1");
    router.refresh();
  }

  async function signUp() {
    if (!validate()) return;
    if (password.length < 6) {
      setError("Пароль слишком короткий — нужно минимум 6 символов.");
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (err) {
      setError(authErrorMessage(err));
      return;
    }

    if (data.session) {
      // Email-подтверждение выключено — сессия есть сразу.
      router.push("/onboarding");
      router.refresh();
      return;
    }

    // Нет сессии = в Supabase включён «Confirm email» — письмо ушло на почту.
    setError(
      "Мы отправили письмо для подтверждения — проверь почту и перейди по ссылке.",
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">НИКА</p>
        <h1 className="mt-4 font-serif text-5xl leading-tight text-ink-primary">Вход</h1>
        <p className="mt-3 text-ink-secondary">Войди или создай аккаунт, чтобы начать.</p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <input
          type="email"
          autoFocus
          placeholder="Email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          disabled={loading}
          className="w-full rounded-card bg-surface-warm px-4 py-3 text-ink-primary outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          disabled={loading}
          className="w-full rounded-card bg-surface-warm px-4 py-3 text-ink-primary outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
        />

        {error && (
          <p className="text-center text-sm text-accent leading-relaxed">{error}</p>
        )}

        <button
          onClick={signIn}
          disabled={loading}
          className="mt-1 h-[50px] w-full rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent disabled:opacity-50"
        >
          {loading ? "Загрузка…" : "Войти"}
        </button>

        <button
          onClick={signUp}
          disabled={loading}
          className="h-[50px] w-full rounded-pill border border-line-default text-[15px] font-medium text-ink-primary transition-colors hover:bg-surface-nika disabled:opacity-50"
        >
          Зарегистрироваться
        </button>
      </div>
    </main>
  );
}
