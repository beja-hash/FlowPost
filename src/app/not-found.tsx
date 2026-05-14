import Link from "next/link";

import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="surface-card bg-grid w-full max-w-xl rounded-[2rem] border p-8 text-center">
        <div className="mx-auto mb-6 flex justify-center">
          <Brand compact />
        </div>
        <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Такой страницы больше нет.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
          Возможно, адрес изменился или ссылка устарела.
        </p>
        <div className="mt-8 flex justify-center">
          <Link href="/" className={buttonVariants()}>
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
