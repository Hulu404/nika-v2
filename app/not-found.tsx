import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="font-serif text-6xl text-ink-primary">Здесь пусто</h1>
      <p className="mt-3 text-ink-secondary">
        Такой страницы нет. Но НИКА на месте.
      </p>
      <Link href="/" className="mt-8">
        <Button>На главную</Button>
      </Link>
    </main>
  );
}
