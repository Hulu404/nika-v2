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

  // Гость: защищённые маршруты — на вход; "/" и "/auth" доступны.
  if (!user) {
    if (pathname.startsWith("/chat") || pathname === "/onboarding") {
      const url = request.nextUrl.clone();
      url.pathname = "/auth";
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
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
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Онбординг пройден: /onboarding и /auth больше не нужны.
  if (pathname === "/onboarding" || pathname === "/auth") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // "/" и "/onboarding" добавлены, чтобы заворачивать на онбординг сразу
  // после входа. /auth/callback намеренно вне матчера и не блокируется.
  matcher: ["/", "/chat/:path*", "/auth", "/onboarding"],
};
