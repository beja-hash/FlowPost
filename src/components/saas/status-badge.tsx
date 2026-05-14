import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "positive" | "warning" | "danger" | "info";

const toneStyles: Record<StatusTone, string> = {
  neutral: "border-border/70 bg-secondary text-secondary-foreground",
  positive:
    "border-emerald-500/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-amber-500/15 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger:
    "border-red-500/15 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-primary/15 bg-primary/10 text-primary",
};

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full px-2.5 py-1", toneStyles[tone], className)}
    >
      {children}
    </Badge>
  );
}
