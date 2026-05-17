import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { serviceInfo } from "@/lib/legal";

export const metadata = {
  title: "Оплата не завершена",
};

export default function PaymentFailPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-220px)] w-full max-w-3xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 lg:px-8">
      <span className="bg-destructive/12 text-destructive grid size-16 place-items-center rounded-2xl">
        <AlertCircle className="size-8" />
      </span>
      <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em]">
        Оплата не завершена
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-8">
        Платеж был отменен или не прошел. Попробуйте снова или свяжитесь с
        поддержкой.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/pricing" className={buttonVariants()}>
          Вернуться к тарифам
        </Link>
        <a
          href={`mailto:${serviceInfo.supportEmail}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Написать в поддержку
        </a>
      </div>
    </div>
  );
}
