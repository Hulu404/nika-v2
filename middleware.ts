import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile, isProfileComplete } from "@/lib/profile";
import type { Database } from "@/types/database";

export async function middleware(request: NextRequest) {
  // Базовый ответ; пересоздаётся, если Supabase обновит cookies сессии.
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // getUser() заодно обновляет сессию (рефреш токена) и пишет cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

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
    return res;
  };

  // Rewrite с переносом cookies (по аналогии с redirect выше).
  const rewrite = (url: URL) => {
    const res = NextResponse.rewrite(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
    res.headers.set("Cache-Control", "no-store, must-revalidate");
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
      pathname === "/onboarding"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth";
      url.search = "";
      url.searchParams.set("next", pathname);
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
  matcher: ["/", "/day1", "/day1/:path*", "/today", "/today/:path*", "/journal", "/journal/:path*", "/analytics", "/analytics/:path*", "/chat/:path*", "/auth", "/onboarding", "/profile", "/profile/:path*"],
};
