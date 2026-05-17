import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Оплата прошла успешно",
};

export default function PaymentSuccessPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-220px)] w-full max-w-3xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 lg:px-8">
      <span className="grid size-16 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-300">
        <CheckCircle2 className="size-8" />
      </span>
      <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em]">
        Оплата прошла успешно
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-8">
        Доступ к FlowPost будет активирован автоматически или после проверки
        платежа.
      </p>
      <Link href="/dashboard" className={`${buttonVariants()} mt-8`}>
        Перейти в кабинет
      </Link>
    </div>
  );
}
