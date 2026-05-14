import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Brand />
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Тарифы
          </Link>
          <Link href="/dashboard" className="transition-colors hover:text-foreground">
            Дашборд
          </Link>
          <a
            href="#features"
            className="transition-colors hover:text-foreground"
          >
            Возможности
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/dashboard"
            className={cn(
              buttonVariants({ size: "sm" }),
              "rounded-full px-4",
            )}
          >
            Открыть продукт
          </Link>
        </div>
      </div>
    </header>
  );
}
