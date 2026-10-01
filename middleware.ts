import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Content-Security-Policy с per-request nonce. Пока в режиме **Report-Only**:
 * браузер только сообщает о нарушениях (в консоль / SecurityPolicyViolationEvent),
 * ничего не блокирует. Это безопасная фаза наблюдения — собираем реальные
 * нарушения (в частности от Yandex.Metrika) и тюним политику, прежде чем
 * переключать на enforcing (заголовок Content-Security-Policy без -Report-Only).
 *
 * Заметки по директивам:
 * - script-src: 'strict-dynamic' даёт право подгрузки скриптов тем, что уже
 *   доверены через nonce (так Metrika грузится без перечисления доменов).
 * - style-src 'unsafe-inline' — намеренно: приложение использует inline
 *   style-атрибуты (style={{...}}), их nonce'ом не пометить. Инъекция стилей
 *   куда менее опасна, чем скриптов; главную защиту даёт script-src.
 * - mc.yandex.ru в img-src/connect-src — пиксель и беконы Metrika/webvisor.
 */
function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://mc.yandex.ru`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://mc.yandex.ru`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  // Per-request nonce + CSP (Report-Only). CSP-RO в request-хедерах нужен,
  // чтобы Next подставил этот же nonce в свои <script> (см. app-render.js:572).
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Заголовки запроса, которые уедут вниз (в роуты и серверные компоненты).
  // Собираются заново на каждый вызов, а НЕ снимаются снимком один раз:
  // request.cookies.set() ниже пишет обновлённый `Cookie` прямо в
  // request.headers, и отсоединённая копия этого уже не увидит — downstream
  // получил бы старый, только что ротированный refresh-токен и упал бы на
  // "Invalid Refresh Token: Refresh Token Not Found".
  const buildRequestHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy-report-only", csp);
    return headers;
  };

  // Базовый ответ; пересоздаётся, если Supabase обновит cookies сессии.
  let response = NextResponse.next({ request: { headers: buildRequestHeaders() } });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Пересобираем заголовки уже ПОСЛЕ мутации cookies — так свежая
          // сессия доезжает до роута/страницы в этом же запросе.
          response = NextResponse.next({ request: { headers: buildRequestHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // CSP-Report-Only на базовый ответ; redirect/rewrite ниже выставляют свой.
  response.headers.set("Content-Security-Policy-Report-Only", csp);

  // getUser() заодно обновляет сессию (рефреш токена) и пишет cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API: ранний выход. getUser() выше уже сделал ротацию и положил свежие
  // cookies в `response` — роут получит их в request и вернёт клиенту, поэтому
  // getUser() внутри роута видит живой токен и не рефрешит его во время стрима
  // (в стриме Set-Cookie уже не доедет: заголовки отправлены). Гейтинг здесь
  // намеренно не делаем: заворачивать fetch на /auth или /onboarding нельзя —
  // фронт получил бы HTML вместо JSON. Отсутствие сессии роуты отдают 401 сами.
  if (pathname.startsWith("/api")) {
    return response;
  }

  // Корень "/" отдаёт разный контент в зависимости от авторизации
  // (гость → лендинг, вошедший → приложение), поэтому его НЕЛЬЗЯ кэшировать:
  // иначе закэшированный лендинг прилетает вошедшему (и наоборот).
  if (pathname === "/") {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  // Лендинг для гостя. Это статический самодостаточный HTML (инлайн-скрипты,
  // blob-видео): nonce-CSP к нему неприменим, поэтому CSP здесь не отдаём
  // (иначе при переводе Report-Only в боевой режим пропадут видео и анимации).
  // Кэш публичный на 5 минут, но корень отдаёт разный контент гостю и вошедшему,
  // поэтому Vary: Cookie: после входа браузер не подставит закэшированный лендинг.
  // Если в ответ едут Set-Cookie (рефреш сессии), кэшировать нельзя.
  const rewriteLanding = (url: URL) => {
    const res = NextResponse.rewrite(url);
    const carried = response.cookies.getAll();
    carried.forEach((c) => res.cookies.set(c.name, c.value, c));
    res.headers.set(
      "Cache-Control",
      carried.length
        ? "no-store, must-revalidate"
        : "public, max-age=300, stale-while-revalidate=86400",
    );
    res.headers.set("Vary", "Cookie");
    return res;
  };

  // Приложение для вошедшего: тот же статический HTML, что на /start
  // (public/app/index.html). Данные он берёт из /api/v2, поэтому nonce-CSP
  // к нему не применяется, кэш запрещён.
  const rewriteApp = (url: URL) => {
    const res = NextResponse.rewrite(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    res.headers.set("Vary", "Cookie");
    return res;
  };

  // Корень: гость видит лендинг, вошедший получает приложение. URL остаётся "/".
  // Онбординг, вход и все экраны живут внутри приложения; старые адреса
  // перенаправляются в next.config.mjs (redirects).
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/app/index.html" : "/landing.html";
    url.search = "";
    return user ? rewriteApp(url) : rewriteLanding(url);
  }

  return response;
}

export const config = {
  // "/" нужен, чтобы отдать гостю лендинг, а вошедшему приложение.
  // Старые страницы (/today, /chat, /journal…) перенаправляются в next.config.mjs.
  // /auth/callback и /auth/confirm намеренно вне матчера и не блокируются.
  //
  // Пользовательские /api/* перечислены поимённо (не общим "/api/:path*"),
  // потому что машинные эндпоинты гонять через пользовательскую сессию нельзя.
  // Вне матчера намеренно оставлены: /api/telegram/webhook, /api/telegram/
  // set-webhook, /api/robokassa/result, /api/cron/*, /api/push/send,
  // /api/telegram/notifications/* (вебхуки и кроны, авторизация по CRON_SECRET
  // или подписи) и /api/auth/* (регистрация и восстановление — до входа).
  matcher: [
    "/",
    "/api/chat", "/api/chat/:path*",
    "/api/usage",
    "/api/rhythm/advice",
    "/api/sprint/advice",
    "/api/notifications/:path*",
    "/api/prefs/:path*",
    "/api/consents",
    "/api/v2/:path*",
    "/api/push/subscribe",
    "/api/telegram/link",
    "/api/telegram/unlink",
  ],
};
