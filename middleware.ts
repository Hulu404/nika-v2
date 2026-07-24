import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile, isProfileComplete } from "@/lib/profile";
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
 *   доверены через nonce (так Metrika и gtag.js грузятся без перечисления доменов).
 * - style-src 'unsafe-inline' — намеренно: приложение использует inline
 *   style-атрибуты (style={{...}}), их nonce'ом не пометить. Инъекция стилей
 *   куда менее опасна, чем скриптов; главную защиту даёт script-src.
 * - mc.yandex.ru в img-src/connect-src — пиксель и беконы Metrika/webvisor.
 * - *.google-analytics.com / *.googletagmanager.com — беконы и пиксели GA4 (gtag).
 */
function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://mc.yandex.ru https://*.google-analytics.com https://*.googletagmanager.com`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://mc.yandex.ru https://*.google-analytics.com https://*.googletagmanager.com`,
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

  // Редирект с переносом свежих cookies сессии. Без этого ротация
  // refresh-токена, выполненная getUser() выше, теряется: NextResponse.redirect
  // создаёт новый ответ без обновлённых Set-Cookie, и следующий запрос падает
  // с "Invalid Refresh Token: Refresh Token Not Found", выкидывая пользователя.
  const redirect = (url: URL) => {
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
    res.headers.set("Content-Security-Policy-Report-Only", csp);
    return res;
  };

  // Rewrite с переносом cookies (по аналогии с redirect выше).
  const rewrite = (url: URL) => {
    const res = NextResponse.rewrite(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    res.headers.set("Content-Security-Policy-Report-Only", csp);
    return res;
  };

  // Гость: корень отдаёт лендинг; защищённые маршруты — на вход;
  // "/auth" доступен. Лендинг рендерится через rewrite (URL остаётся "/"),
  // чтобы вошедший пользователь дошёл до app/page.tsx и попал в приложение.
  if (!user) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/landing.html";
      url.search = "";
      return rewrite(url);
    }
    if (
      pathname.startsWith("/chat") ||
      pathname.startsWith("/day1") ||
      pathname.startsWith("/today") ||
      pathname.startsWith("/journal") ||
      pathname.startsWith("/analytics") ||
      pathname.startsWith("/rhythm") ||
      pathname.startsWith("/meditations") ||
      pathname === "/onboarding"
    ) {
      const url = request.nextUrl.clone();
      const original = pathname + request.nextUrl.search; // сохраняем query (напр. ?src=tg_morning)
      url.pathname = "/auth";
      url.search = "";
      url.searchParams.set("next", original);
      return redirect(url);
    }
    return response;
  }

  // Авторизован: проверяем, пройден ли онбординг.
  const profile = await getProfile(supabase, user.id);

  if (!isProfileComplete(profile)) {
    // Профиль не заполнен — ведём на онбординг (кроме самой страницы).
    if (pathname !== "/onboarding") {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return redirect(url);
    }
    return response;
  }

  // Онбординг пройден: /onboarding и /auth больше не нужны.
  if (pathname === "/onboarding" || pathname === "/auth") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirect(url);
  }

  return response;
}

export const config = {
  // "/" и "/onboarding" добавлены, чтобы заворачивать на онбординг сразу
  // после входа. /auth/callback намеренно вне матчера и не блокируется.
  //
  // Пользовательские /api/* перечислены поимённо (не общим "/api/:path*"),
  // потому что машинные эндпоинты гонять через пользовательскую сессию нельзя.
  // Вне матчера намеренно оставлены: /api/telegram/webhook, /api/telegram/
  // set-webhook, /api/robokassa/result, /api/cron/*, /api/push/send,
  // /api/telegram/notifications/* (вебхуки и кроны, авторизация по CRON_SECRET
  // или подписи) и /api/auth/* (регистрация и восстановление — до входа).
  matcher: [
    "/", "/day1", "/day1/:path*", "/today", "/today/:path*", "/journal", "/journal/:path*", "/analytics", "/analytics/:path*", "/rhythm", "/rhythm/:path*", "/meditations", "/meditations/:path*", "/chat/:path*", "/auth", "/onboarding", "/profile", "/profile/:path*",
    "/api/chat", "/api/chat/:path*",
    "/api/usage",
    "/api/rhythm/advice",
    "/api/sprint/advice",
    "/api/notifications/:path*",
    "/api/prefs/:path*",
    "/api/push/subscribe",
    "/api/telegram/link",
    "/api/telegram/unlink",
  ],
};
