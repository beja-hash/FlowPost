import Link from "next/link";

import { cn } from "@/lib/utils";

type BrandProps = {
  compact?: boolean;
  className?: string;
};

export function Brand({ compact = false, className }: BrandProps) {
  return (
    <Link
      href="/dashboard"
      className={cn(
        "group/brand focus-visible:ring-ring/30 inline-flex min-w-0 items-center gap-3 rounded-2xl transition-all duration-200 outline-none focus-visible:ring-4",
        compact && "w-full justify-center gap-0",
        className,
      )}
      aria-label="Главная Posting"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_24%_18%,rgba(255,255,255,0.9),transparent_18%),linear-gradient(135deg,#10141f_0%,#0b0e15_45%,#263449_100%)] text-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.85)] ring-1 ring-black/10 transition-transform duration-200 group-hover/brand:-translate-y-0.5 dark:border-white/12">
        <span className="absolute -top-5 -right-4 size-10 rounded-full bg-cyan-300/25 blur-xl" />
        <span className="absolute -bottom-4 -left-4 size-10 rounded-full bg-amber-200/20 blur-xl" />
        <span className="absolute top-2 left-2 size-1.5 rounded-full bg-cyan-200/80" />
        <span className="absolute right-2.5 bottom-2.5 size-1 rounded-full bg-white/70" />
        <span className="font-heading relative text-lg font-semibold tracking-[-0.08em]">
          P
        </span>
      </span>
      {!compact ? (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="font-heading text-base font-semibold tracking-[-0.03em]">
            Posting
          </span>
          <span className="text-muted-foreground mt-1 truncate text-[0.7rem] font-medium">
            Распространение ИИ-контента
          </span>
        </span>
      ) : null}
    </Link>
  );
}
