import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingHeader() {
  return (
    <header className="border-border/60 bg-background/75 sticky top-0 z-30 border-b backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Brand href="/" />
        <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
          <Link
            href="/pricing"
            className="hover:text-foreground transition-colors"
          >
            Тарифы
          </Link>
          <Link
            href="/contacts"
            className="hover:text-foreground transition-colors"
          >
            Контакты
          </Link>
          <a
            href="#features"
            className="hover:text-foreground transition-colors"
          >
            Возможности
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ size: "sm" }), "rounded-full px-4")}
          >
            Открыть продукт
          </Link>
        </div>
      </div>
    </header>
  );
}
