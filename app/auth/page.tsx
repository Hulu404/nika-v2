"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClientComponentClient } from "@/lib/supabase";

type Status = "idle" | "sending" | "sent";

export default function AuthPage() {
  const [supabase] = useState(() => createClientComponentClient());
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Показываем подсказку, если вернулись сюда с ошибкой из callback
  // (просроченная/недействительная ссылка).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Ссылка недействительна или истекла. Запроси новую.");
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || status === "sending") return;

    setStatus("sending");
    setError(null);

    const params = new URLSearchParams(window.location.search);
    const nextParam = params.get("next");
    const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo },
    });

    if (authError) {
      setStatus("idle");
      setError("Не получилось отправить ссылку. Попробуй ещё раз.");
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          НИКА
        </p>
        <h1 className="mt-4 font-serif text-5xl leading-tight text-ink-primary">
          {status === "sent" ? "Письмо отправлено" : "Вход"}
        </h1>
        <p className="mt-3 text-ink-secondary">
          {status === "sent"
            ? "Проверь почту, ссылка уже там."
            : "Введи email — пришлём ссылку для входа без пароля."}
        </p>
      </div>

      {status === "sent" ? (
        <p className="mt-8 text-center text-sm text-ink-muted">
          Не пришло? Загляни в спам или{" "}
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setError(null);
            }}
            className="text-accent underline underline-offset-2"
          >
            попробуй другой email
          </button>
          .
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <Input
            type="email"
            required
            autoFocus
            inputMode="email"
            autoComplete="email"
            placeholder="ты@почта.ру"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "sending"}
          />
          <Button type="submit" disabled={status === "sending" || !email.trim()}>
            {status === "sending" ? "Отправляем…" : "Получить ссылку"}
          </Button>
          {error && (
            <p className="text-center text-sm text-accent">{error}</p>
          )}
        </form>
      )}
    </main>
  );
}
