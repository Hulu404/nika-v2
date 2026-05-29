"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClientComponentClient } from "@/lib/supabase";

type Mode = "idle" | "loading";

export default function AuthPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode]         = useState<Mode>("idle");
  const [error, setError]       = useState<string | null>(null);

  // Ошибка из callback (просроченная ссылка и т.п.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Не удалось войти. Попробуй снова.");
    }
  }, []);

  function disabled() {
    return mode === "loading" || !email.trim() || !password.trim();
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (disabled()) return;

    setMode("loading");
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setMode("idle");
      setError(
        authError.message.includes("Invalid login credentials")
          ? "Неверный email или пароль."
          : "Не получилось войти. Попробуй ещё раз.",
      );
      return;
    }

    router.push("/day1");
    router.refresh();
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    if (disabled()) return;

    setMode("loading");
    setError(null);

    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (authError) {
      setMode("idle");
      setError(
        authError.message.includes("already registered")
          ? "Этот email уже зарегистрирован. Попробуй войти."
          : "Не получилось зарегистрироваться. Попробуй ещё раз.",
      );
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

      <form className="mt-8 flex flex-col gap-3">
        <Input
          type="email"
          required
          autoFocus
          inputMode="email"
          autoComplete="email"
          placeholder="ты@почта.ру"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={mode === "loading"}
        />
        <Input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={mode === "loading"}
        />

        {error && (
          <p className="text-center text-sm text-accent">{error}</p>
        )}

        <Button
          type="submit"
          pill
          disabled={disabled()}
          onClick={signIn}
          className="mt-1 h-[50px] w-full text-[15px]"
        >
          {mode === "loading" ? "Входим…" : "Войти"}
        </Button>

        <Button
          type="button"
          variant="outline"
          pill
          disabled={disabled()}
          onClick={signUp}
          className="h-[50px] w-full text-[15px]"
        >
          Зарегистрироваться
        </Button>
      </form>
    </main>
  );
}
