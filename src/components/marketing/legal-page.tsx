import type { ReactNode } from "react";

import { legalUpdatedAt } from "@/lib/legal";
import { cn } from "@/lib/utils";

type LegalPageProps = {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
};

export function LegalPage({
  title,
  eyebrow = "Документы FlowPost",
  children,
  className,
}: LegalPageProps) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <div className="mb-10">
        <p className="text-primary text-sm font-medium tracking-[0.22em] uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-4 text-sm">
          Дата актуализации: {legalUpdatedAt}
        </p>
      </div>
      <div className={cn("space-y-6", className)}>{children}</div>
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border/60 bg-card/70 rounded-2xl border p-6 shadow-[0_24px_80px_-58px_rgba(0,0,0,0.9)] sm:p-8">
      <h2 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
      <div className="text-muted-foreground mt-5 space-y-4 text-base leading-7">
        {children}
      </div>
    </section>
  );
}

export function DetailList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="divide-border/50 divide-y">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[240px_1fr]"
        >
          <dt className="text-muted-foreground text-sm font-medium">
            {item.label}
          </dt>
          <dd className="text-foreground text-base">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
