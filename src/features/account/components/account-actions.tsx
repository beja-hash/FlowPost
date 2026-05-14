"use client";

import { CreditCard, LogOut, RefreshCw, UserRound, XCircle } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AccountSessionActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => void signOut({ callbackUrl: "/sign-in" })}
      >
        <UserRound />
        Сменить аккаунт
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => void signOut({ callbackUrl: "/" })}
      >
        <LogOut />
        Выйти
      </Button>
    </div>
  );
}

export function BillingActionButtons() {
  const notifyBilling = (label: string) => {
    toast.info(`${label}: платежный кабинет пока не подключен.`);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Link href="/pricing" className={cn(buttonVariants())}>
        <RefreshCw />
        Изменить план
      </Link>
      <Button
        type="button"
        variant="secondary"
        onClick={() => notifyBilling("Обновить способ оплаты")}
      >
        <CreditCard />
        Обновить способ оплаты
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={() => notifyBilling("Отменить подписку")}
      >
        <XCircle />
        Отменить подписку
      </Button>
    </div>
  );
}
