"use client";

import { useEffect, useState } from "react";
import { PageTransition } from "@/components/PageTransition";
import { cn } from "@/lib/utils";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // Мягкое состояние из /auth/confirm при недействительной ссылке.
    if (new URLSearchParams(window.location.search).get("state") === "expired") {
      setExpired(true);
    }
  }, []);

  const emailOk = emailRe.test(email.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk || loading) return;
    setLoading(true);
    try {
      // Куда придёт ссылка (бот и/или почта) — решает бэкенд. Ответ нейтральный.
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      /* показываем то же нейтральное состояние */
    }
    setLoading(false);
    setDone(true);
  }

  return (
    <PageTransition>
      <div
        className="relative flex min-h-dvh w-full items-center justify-center px-4"
        style={{ backgroundColor: "var(--bg-canvas)" }}
      >
        <div className="w-full max-w-[420px] rounded-card border border-line-subtle bg-canvas px-[22px] pb-[26px] pt-6 shadow-card">
          <h1 className="font-serif text-[26px] font-normal leading-[1.2] tracking-[-0.02em] text-ink-primary">
            Забыли пароль?
          </h1>

          {expired && !done && (
            <p className="mb-2 mt-3 text-[13px] leading-relaxed text-accent">
              Ссылка устарела или уже использована. Запроси новую.
            </p>
          )}

          {done ? (
            <p className="mt-3 text-[14px] leading-[1.6] text-ink-secondary">
              Если аккаунт с такой почтой есть, мы пришлём ссылку для сброса пароля.
              Загляни в Telegram и в почту.
            </p>
          ) : (
            <>
              <p className="mb-[22px] mt-2.5 text-[14px] leading-[1.5] text-ink-secondary">
                Введи почту — пришлём ссылку для сброса. Если подключён Telegram, ссылка
                придёт туда.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <div className="flex items-center gap-2.5 rounded-input border-[1.5px] border-line-default bg-elevated px-3.5 transition-all focus-within:border-ink-primary">
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="ты@почта.рф"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-ink-primary outline-none placeholder:text-ink-muted disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!emailOk || loading}
                  className={cn(
                    "mt-1 flex h-[54px] items-center justify-center rounded-pill text-[15px] font-medium text-canvas transition-colors",
                    emailOk && !loading ? "bg-ink-primary hover:bg-accent" : "cursor-not-allowed bg-ink-faint",
                  )}
                >
                  {loading ? "Отправляем…" : "Прислать ссылку"}
                </button>
              </form>
            </>
          )}

          <p className="mt-5 text-[13.5px] text-ink-secondary">
            <a href="/auth" className="font-medium text-accent underline-offset-2 hover:underline">
              Вернуться ко входу
            </a>
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
