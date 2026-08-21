"use client";

import { useEffect, useRef, useState } from "react";

/* ── Шрифт Onest ── */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Onest:wght@300;400;500;600;700&display=swap";

/* ── Инлайновые стили страницы (перенесены из nika-activate.html без изменений) ── */
const CSS = `
:root{
  --sand:#B4553A;--sand-2:#F8EFE9;--terra-deep:#8E3F2A;--cream:#FCF3E7;
  --cream-2:rgba(252,243,231,.78);--cream-3:rgba(252,243,231,.62);
  --terra-glass:
    radial-gradient(70% 55% at 16% 6%,rgba(255,236,214,.40),transparent 62%),
    radial-gradient(52% 44% at 88% 10%,rgba(201,150,63,.34),transparent 66%),
    radial-gradient(62% 52% at 78% 96%,rgba(142,63,42,.55),transparent 70%),
    linear-gradient(162deg,#C8553D 0%,#B4553A 46%,#A2472E 100%);
  --brick:#B4553A;--brick-2:#98452D;--brick-soft:#F6E4DC;
  --ink:#121416;--ink-2:#5C544B;--ink-3:#8C8479;--line:#E2DBD0;
  --line-w:rgba(252,243,231,.24);
  --sans:"Onest","Manrope",-apple-system,system-ui,"Segoe UI",sans-serif;
  --pad:40px;
}
.act-body{font-family:var(--sans);background:var(--sand);color:var(--cream);
  line-height:1.45;font-weight:400;-webkit-font-smoothing:antialiased;
  overflow-x:hidden;min-height:100vh;display:flex;flex-direction:column}
.act-body a{color:inherit;text-decoration:none}
.act-body button,.act-body input{font:inherit;color:inherit}
.act-body p{text-wrap:pretty}
.act-body :focus-visible{outline:2px solid var(--cream);outline-offset:3px;border-radius:6px}
.act-wrap{max-width:1180px;margin:0 auto;padding:0 var(--pad);width:100%}
.act-d1{font-size:clamp(32px,4.6vw,60px);font-weight:600;line-height:1.05;letter-spacing:-.034em}
.act-lead{font-size:clamp(16px,1.6vw,19px);color:var(--cream-2)}
.act-pill{display:inline-flex;align-items:center;gap:9px;border-radius:999px;padding:0 16px;
  height:34px;font-size:13px;font-weight:600;line-height:1;white-space:nowrap}
.act-pill--light{background:rgba(255,255,255,.72);color:var(--brick-2)}
.act-pill--soft{background:var(--brick-soft);color:var(--brick-2)}
.act-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:60px;
  padding:0 34px;border-radius:14px;font-size:17px;font-weight:600;cursor:pointer;
  border:0;white-space:nowrap;transition:transform .2s,background .2s,box-shadow .2s;
  text-decoration:none}
.act-btn:hover{transform:translateY(-2px)}
.act-btn:active{transform:scale(.99)}
.act-btn--brick{background:var(--brick);color:#fff}
.act-btn--brick:hover{background:var(--brick-2)}
.act-btn[disabled]{opacity:.55;pointer-events:none}
.logo-n{border-radius:50%;background-image:url("data:image/png;base64,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");
  background-size:cover;background-position:center;flex:none;display:inline-block;
  width:30px;height:30px}
.act-top{height:72px;display:flex;align-items:center;flex:none}
.act-top .act-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
.act-lock{display:flex;align-items:center;gap:12px;min-width:0}
.act-lock .nm{display:flex;flex-direction:column;line-height:1}
.act-lock .nm i{font-style:normal;font-size:9px;font-weight:600;letter-spacing:.16em;opacity:.6;text-transform:uppercase}
.act-lock .nm b{font-size:16px;font-weight:600;letter-spacing:.06em}
.act-lock .sep{opacity:.42;font-size:15px}
.act-lock .surf b{font-family:"Times New Roman",Times,Georgia,serif;font-size:18px;font-weight:400}
.act-lock .surf b sup{font-size:.45em;vertical-align:super;line-height:0}
.sxs{white-space:nowrap}
.sxs i.x{font-style:normal;font-size:.66em;opacity:.6;padding:0 .07em;vertical-align:.08em}
.act-top .hint{font-size:13px;color:var(--cream-3)}
.act-stage{flex:1;background:var(--terra-glass);position:relative;overflow:hidden;
  padding:56px 0 76px;display:flex;align-items:center}
.act-stage:after{content:"";position:absolute;right:-8%;top:-24%;width:52vw;height:52vw;
  border-radius:50%;background:radial-gradient(circle at 40% 40%,rgba(255,248,236,.30),rgba(255,248,236,.06) 62%,transparent 74%);filter:blur(6px)}
.act-stage .act-wrap{position:relative;z-index:2}
.act-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:56px;row-gap:0;align-items:start}
.copy-head{grid-column:1;grid-row:1}
.copy-more{grid-column:1;grid-row:2}
.act-card{grid-column:2;grid-row:1 / span 2;align-self:center}
.act-copy h1{margin:22px 0 18px}
.act-copy .act-lead{max-width:520px}
.act-copy ul{list-style:none;margin-top:34px;display:grid;gap:14px}
.act-copy li{display:flex;gap:12px;font-size:16px;color:var(--cream)}
.act-copy li b{font-weight:600}
.act-copy li .t{display:block;min-width:0}
.act-copy li:before{content:"";width:18px;height:18px;border-radius:50%;background:var(--terra-deep);flex:none;margin-top:3px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.4l3 3 6-6.8' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-size:13px;background-position:center;background-repeat:no-repeat}
.act-pair{display:flex;align-items:center;gap:12px;margin-top:38px;padding-top:26px;
  border-top:1px solid var(--line-w);font-size:14px;flex-wrap:wrap;color:var(--cream-2)}
.act-pair .logo-n{width:26px;height:26px}
.act-pair .wm{font-family:"Times New Roman",Times,Georgia,serif;font-size:17px}
.act-pair .wm sup{font-size:.45em;vertical-align:super;line-height:0}
.act-card{background:#fff;color:var(--ink);border-radius:28px;padding:38px 36px 34px}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:26px}
.card-head h2{font-size:23px;font-weight:600;letter-spacing:-.025em;line-height:1.2}
.card-head p{font-size:14.5px;color:var(--ink-2);margin-top:7px}
.act-promo{background:var(--sand-2);border-radius:16px;padding:20px 22px 22px;
  text-align:center;margin-bottom:20px;position:relative}
.act-promo .k{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.act-promo .v{font-size:clamp(26px,3.4vw,34px);font-weight:600;letter-spacing:.06em;margin:10px 0 4px;
  font-variant-ligatures:none;word-break:break-all}
.act-promo .v.load{color:var(--ink-3);letter-spacing:.02em;font-size:20px;font-weight:500}
.copy-btn{display:inline-flex;align-items:center;gap:7px;background:none;border:0;cursor:pointer;
  font-size:13.5px;font-weight:600;color:var(--brick);padding:6px 4px 0;transition:opacity .18s}
.copy-btn:hover{opacity:.7}
.copy-btn svg{width:15px;height:15px}
.act-steps{display:grid;gap:12px;margin-top:20px}
.stp{display:flex;gap:12px;font-size:14.5px;color:var(--ink-2);line-height:1.4}
.stp b{flex:none;width:22px;height:22px;border-radius:50%;background:var(--brick-soft);
  color:var(--brick-2);font-size:12px;font-weight:600;display:grid;place-items:center;margin-top:1px}
.act-card .act-btn{width:100%}
.act-fine{font-size:13px;color:var(--ink-3);margin-top:18px;line-height:1.5;
  padding-top:16px;border-top:1px solid var(--line)}
.act-fine a{text-decoration:underline;text-underline-offset:2px}
.act-footer{flex:none;background:var(--ink);color:rgba(255,255,255,.6);
  padding:30px 0 calc(34px + env(safe-area-inset-bottom));font-size:13px}
.f-row{display:flex;flex-wrap:wrap;gap:18px;justify-content:space-between;align-items:center}
.f-links{display:flex;gap:22px}
.f-links a:hover{color:#fff}
.f-legal{margin-top:18px;font-size:12px;line-height:1.6;opacity:.5;max-width:780px}
.act-toast{position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom));
  transform:translate(-50%,20px);background:var(--ink);color:#fff;padding:13px 20px;
  border-radius:14px;font-size:14.5px;font-weight:500;opacity:0;pointer-events:none;
  transition:opacity .25s,transform .25s;z-index:90;max-width:calc(100% - 40px);text-align:center}
.act-toast.on{opacity:1;transform:translate(-50%,0)}
.r{opacity:0;transform:translateY(18px)}
.r.in{opacity:1;transform:none;transition:opacity .6s cubic-bezier(.22,.8,.24,1),transform .6s cubic-bezier(.22,.8,.24,1)}
@media(prefers-reduced-motion:reduce){.r{opacity:1;transform:none}.r.in{transition:none}.act-btn:hover{transform:none}}
@media(max-width:980px){:root{--pad:32px}.act-grid{display:flex;flex-direction:column;gap:32px}
  .copy-head{order:1}.act-card{order:2}.copy-more{order:3}.act-stage{padding:40px 0 56px}}
@media(max-width:720px){:root{--pad:20px}.act-top{height:60px}.act-lock{gap:9px}
  .act-lock .nm i{display:none}.act-lock .nm b{font-size:15px}.act-lock .surf b{font-size:16px}
  .logo-n{width:28px;height:28px}.act-top .hint{display:none}
  .act-stage{padding:26px 0 44px;align-items:flex-start}
  .act-stage:after{right:-32%;top:-14%;width:88vw;height:88vw}
  .act-copy h1{margin:18px 0 14px}.act-copy ul{margin-top:24px}.act-copy li{font-size:15.5px}
  .act-pair{margin-top:28px;padding-top:22px}
  .act-card{padding:26px 20px 24px;border-radius:24px}
  .card-head{display:block;margin-bottom:22px}.card-head .act-pill{margin-top:14px}
  .act-btn{width:100%;height:56px;padding:0 20px}
  .act-footer{padding:26px 0 calc(30px + env(safe-area-inset-bottom))}}
`;

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

const APP = "https://www.mynika.online";

export function ActivateClient() {
  const [code, setCode] = useState("direct");
  const [scanId, setScanId] = useState("");
  const [token, setToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenClosed, setTokenClosed] = useState(false);
  const [expiryLabel, setExpiryLabel] = useState("");
  const [fineLabel, setFineLabel] = useState("три недели");
  const [goHref, setGoHref] = useState(`${APP}/signup`);
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const revealRef = useRef<HTMLDivElement[]>([]);

  /* ── Функция тоста ── */
  function toast(text: string) {
    setToastText(text);
    setToastOn(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastOn(false), 3000);
  }

  /* ── Инициализация: код, дата, тост ── */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = (q.get("c") || readCookie("nika_src") || "direct").slice(0, 32);
    const s = (q.get("s") || readCookie("nika_scan") || "").slice(0, 64);
    setCode(c);
    setScanId(s);

    const end = new Date();
    end.setDate(end.getDate() + 21);
    const human = end.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    setExpiryLabel("до " + human);
    setFineLabel("до " + human);
  }, []);

  /* ── Запрос токена ── */
  useEffect(() => {
    if (!code || code === "direct-init") return;
    fetch("/api/promo/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ code, scan_id: scanId || null }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 410 ? "over" : "fail");
        return r.json();
      })
      .then((d: { token?: string; expires_at?: string }) => {
        if (!d?.token) throw new Error("fail");
        setToken(d.token);
        setTokenLoading(false);
        if (d.expires_at) {
          const dt = new Date(d.expires_at);
          if (!isNaN(dt.getTime())) {
            const h = dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
            setExpiryLabel("до " + h);
            setFineLabel("до " + h);
          }
        }
        setGoHref(
          `${APP}/signup?promo=${encodeURIComponent(d.token)}&src=${encodeURIComponent(code)}`,
        );
      })
      .catch((err: Error) => {
        setTokenLoading(false);
        if (err.message === "over") {
          setTokenClosed(true);
          setGoHref(APP);
          toast("Раздача по этому коду закрыта. Напиши на ceo@mynika.ru");
        } else {
          // Аварийный офлайн-код
          setToken("SURF21");
          setGoHref(`${APP}/signup?promo=SURF21&src=${encodeURIComponent(code)}`);
          toast("Код выдан офлайн. Если не сработает, напиши на ceo@mynika.ru");
        }
      });
  }, [code, scanId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── IntersectionObserver для анимации появления ── */
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".r");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e, i) => {
          if (e.isIntersecting) {
            setTimeout(() => e.target.classList.add("in"), i * 90);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  /* ── Копирование промокода ── */
  function copyToken() {
    if (!token) return;
    const done = () => toast("Промокод скопирован");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(token).then(done).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = token;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch {
        toast("Скопируй код вручную");
      }
      document.body.removeChild(ta);
    }
  }

  /* ── Отметка клика по кнопке ── */
  function trackClick() {
    const body = JSON.stringify({ token, code, scan_id: scanId || null });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/promo/click", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/promo/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href={FONT_HREF} rel="stylesheet" />
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="act-body">
        {/* Шапка */}
        <header className="act-top">
          <div className="act-wrap">
            <div className="act-lock">
              <span className="logo-n" role="img" aria-label="НИКА" />
              <span className="nm">
                <i>приложение</i>
                <b>НИКА</b>
              </span>
            </div>
            <span className="hint">
              Код со стакана: <b>{code === "direct" ? "не найден" : code}</b>
            </span>
          </div>
        </header>

        {/* Основной экран */}
        <main className="act-stage">
          <div className="act-wrap">
            <div className="act-grid">

              {/* Левая колонка — верх */}
              <div className="act-copy copy-head r">
                <span className="act-pill act-pill--light">Pro на 21 день</span>
                <h1 className="act-d1">
                  Планы пишут все.<br />Мы работаем с головой.
                </h1>
                <p className="act-lead">
                  Ника разбирает то, что не влезает в тренировочный план: сомнения перед стартом, пропущенные тренировки, решение бежать или остановиться, когда тянет колено.
                </p>
              </div>

              {/* Правая колонка — карточка */}
              <div className="act-card r">
                <div className="card-head">
                  <div>
                    <h2>Включить Pro</h2>
                    <p>Промокод уже твой. Осталось завести аккаунт.</p>
                  </div>
                  <span className="act-pill act-pill--soft">{expiryLabel || " "}</span>
                </div>

                <div className="act-promo">
                  <div className="k">Промокод</div>
                  {tokenClosed ? (
                    <div className="v" style={{ fontSize: 18, color: "var(--ink-3)" }}>
                      раздача закрыта
                    </div>
                  ) : (
                    <div className={`v${tokenLoading ? " load" : ""}`}>
                      {tokenLoading ? "получаем…" : token}
                    </div>
                  )}
                  {!tokenLoading && !tokenClosed && token && (
                    <button type="button" className="copy-btn" onClick={copyToken}>
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      Скопировать
                    </button>
                  )}
                </div>

                <a
                  className="act-btn act-btn--brick"
                  href={goHref}
                  onClick={trackClick}
                >
                  {tokenClosed ? "Открыть НИКУ" : "Активировать Pro"}
                </a>

                <div className="act-steps">
                  <div className="stp"><b>1</b><span>Регистрация в приложении, почта и пароль</span></div>
                  <div className="stp"><b>2</b><span>Промокод подставится сам, вводить ничего не надо</span></div>
                  <div className="stp"><b>3</b><span>Три недели Pro, карту привязывать не нужно</span></div>
                </div>

                <p className="act-fine">
                  Код одноразовый и работает <span>{fineLabel}</span>.{" "}
                  Если ушёл со страницы, введи его вручную в приложении: профиль, промокод.
                </p>
              </div>

              {/* Левая колонка — низ */}
              <div className="act-copy copy-more r">
                <ul>
                  <li><span className="t"><b>Диалог без лимитов</b>, Ника помнит весь спринт целиком</span></li>
                  <li><span className="t"><b>Архетип под твою цель</b> на ближайшие три недели</span></li>
                  <li><span className="t"><b>Дневник, медитации и советы</b> открыты полностью</span></li>
                  <li><span className="t"><b>Карта не нужна</b>, ничего не спишется ни сейчас, ни потом</span></li>
                </ul>
                <div className="act-pair">
                  <span className="logo-n" /> НИКА
                </div>
              </div>

            </div>
          </div>
        </main>

        {/* Подвал */}
        <footer className="act-footer">
          <div className="act-wrap">
            <div className="f-row">
              <div className="act-lock">
                <span className="logo-n" />
                <span className="nm"><b>НИКА</b></span>
              </div>
              <div className="f-links">
                <a href="https://www.mynika.online">mynika.online</a>
                <a href="/legal/privacy">Персональные данные</a>
                <a href="mailto:ceo@mynika.ru">ceo@mynika.ru</a>
              </div>
            </div>
            <div className="f-legal">
              © 2026 · Бег начинается в голове · ИП Серебряков Дмитрий Сергеевич · ИНН 645053987663 · ОГРНИП 326645700053239
            </div>
          </div>
        </footer>

        {/* Тост */}
        <div
          className={`act-toast${toastOn ? " on" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toastText}
        </div>
      </div>
    </>
  );
}
