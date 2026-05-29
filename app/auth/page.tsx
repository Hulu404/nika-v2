"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClientComponentClient } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError("Не удалось войти. Попробуй снова.");
  }, []);

  /** Клиентская валидация до запроса к Supabase. */
  function validate(): string | null {
    if (!email.trim()) return "Введи email.";
    if (password.length < 6) return "Пароль — минимум 6 символов.";
    return null;
  }

  /** Человекочитаемые сообщения об ошибках Supabase. */
  function mapError(msg: string): string {
    if (msg.includes("Invalid login credentials"))     return "Неверный email или пароль.";
    if (msg.includes("already registered") ||
        msg.includes("User already registered"))       return "Этот email уже зарегистрирован — попробуй войти.";
    if (msg.includes("Password should be at least"))   return "Пароль — минимум 6 символов.";
    if (msg.includes("Unable to validate email"))      return "Неверный формат email.";
    if (msg.includes("Email not confirmed"))           return "Подтверди email — письмо уже у тебя в почте.";
    return "Что-то пошло не так. Попробуй ещё раз.";
  }

  const isDisabled = loading || !email.trim() || password.length < 6;

  async function signIn(e: FormEvent) {
    e.preventDefault();
    const ve = validate();
    if (ve) { setError(ve); return; }

    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (authError) { setError(mapError(authError.message)); return; }

    router.push("/day1");
    router.refresh();
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    const ve = validate();
    if (ve) { setError(ve); return; }

    setLoading(true);
    setError(null);

    // Создаём пользователя через серверный admin API (email_confirm: true).
    // Никаких писем — пользователь сразу подтверждён.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    const json = await res.json();

    if (!res.ok) {
      setLoading(false);
      setError(mapError(json.error ?? ""));
      return;
    }

    // Входим с только что созданными учётными данными.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (signInError) {
      setError("Аккаунт создан — попробуй войти.");
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          НИКА
        </p>
        <h1 className="mt-4 font-serif text-5xl leading-tight text-ink-primary">
          Вход
        </h1>
        <p className="mt-3 text-ink-secondary">
          Войди или создай аккаунт, чтобы начать.
        </p>
      </div>

      <form className="mt-8 flex flex-col gap-3" onSubmit={signIn}>
        <Input
          type="email"
          required
          autoFocus
          inputMode="email"
          autoComplete="email"
          placeholder="ты@почта.ру"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          disabled={loading}
        />
        <Input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Пароль — минимум 6 символов"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          disabled={loading}
        />

        {error && <p className="text-center text-sm text-accent">{error}</p>}

        <Button
          type="submit"
          pill
          disabled={isDisabled}
          className="mt-1 h-[50px] w-full text-[15px]"
        >
          {loading ? "Входим…" : "Войти"}
        </Button>

        <Button
          type="button"
          variant="outline"
          pill
          disabled={isDisabled}
          onClick={signUp}
          className="h-[50px] w-full text-[15px]"
        >
          Зарегистрироваться
        </Button>
      </form>
    </main>
  );
}
