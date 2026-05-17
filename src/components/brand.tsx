import Link from "next/link";

import { cn } from "@/lib/utils";

type BrandProps = {
  compact?: boolean;
  className?: string;
  tone?: "default" | "sidebar";
};

export function Brand({
  compact = false,
  className,
  tone = "default",
}: BrandProps) {
  const labelClass =
    tone === "sidebar" ? "text-sidebar-foreground" : "text-foreground";
  const subtitleClass =
    tone === "sidebar" ? "text-sidebar-foreground/58" : "text-muted-foreground";

  return (
    <Link
      href="/dashboard"
      className={cn(
        "group/brand focus-visible:ring-ring/30 inline-flex min-w-0 items-center gap-3 rounded-2xl transition-all duration-200 outline-none focus-visible:ring-4",
        compact && "w-full justify-center gap-0",
        className,
      )}
      aria-label="Главная FlowPost"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,#171c26_0%,#0c1119_55%,#182432_100%)] text-white shadow-[0_18px_50px_-26px_rgba(2,6,23,0.92)] ring-1 ring-black/20 transition-transform duration-200 group-hover/brand:-translate-y-0.5 dark:border-white/12">
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(146,197,253,0.28),transparent_34%)]" />
        <span className="absolute right-0 bottom-0 h-7 w-8 rounded-tl-full bg-emerald-300/10 blur-sm" />
        <span className="relative grid size-6 place-items-center">
          <span className="absolute left-0 top-1 h-1.5 w-4 rounded-full bg-slate-100/88" />
          <span className="absolute left-1 top-2.5 h-1.5 w-5 rounded-full bg-sky-200/85" />
          <span className="absolute left-2 top-4 h-1.5 w-4 rounded-full bg-emerald-200/80" />
          <span className="absolute right-0 top-2.5 size-1.5 rounded-full bg-white/80" />
        </span>
      </span>
      {!compact ? (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className={cn(
              "font-heading text-base font-semibold tracking-normal",
              labelClass,
            )}
          >
            FlowPost
          </span>
          <span
            className={cn("mt-1 truncate text-[0.7rem] font-medium", subtitleClass)}
          >
            Контент-дистрибуция
          </span>
        </span>
      ) : null}
    </Link>
  );
}
