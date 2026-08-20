import { redirect } from "next/navigation";

/**
 * /signup?promo=TOKEN&src=CODE → /auth?promo=TOKEN&src=CODE
 *
 * Страница активации ведёт на /signup (исторически). Здесь делаем
 * redirect с прокидыванием всех query-параметров.
 */
export default function SignupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const promo = typeof searchParams.promo === "string" ? searchParams.promo : "";
  const src   = typeof searchParams.src   === "string" ? searchParams.src   : "";

  const dest = new URL("/auth", "https://placeholder");
  dest.searchParams.set("mode", "signup");
  if (promo) dest.searchParams.set("promo", promo);
  if (src)   dest.searchParams.set("src",   src);

  redirect(dest.pathname + dest.search);
}
