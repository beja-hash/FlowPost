"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { BillingPlan } from "@/features/billing/plans";

export function PlanSelectButton({
  plan,
  highlighted = false,
}: {
  plan: Pick<BillingPlan, "id" | "name">;
  highlighted?: boolean;
}) {
  return (
    <Button
      type="button"
      size="lg"
      variant={highlighted ? "default" : "secondary"}
      className="h-12 w-full text-base"
      onClick={() => {
        toast.info(
          `Тариф «${plan.name}» выбран. Подключение оплаты появится после запуска платежного кабинета.`,
        );
      }}
    >
      Выбрать {plan.name}
    </Button>
  );
}
