"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

export function GoogleSignInButton() {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  return (
    <Button
      variant="outline"
      className="h-12 w-full justify-center gap-3 rounded-2xl border-border/45 bg-background/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:border-border/70 hover:bg-background/80"
      size="lg"
      onClick={() =>
        startTransition(() => {
          void signIn("google", { callbackUrl }).catch((error) => {
            console.error("[auth:google-button] signIn failed", error);
          });
        })
      }
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <span className="grid size-5 place-items-center rounded-full bg-white text-xs font-bold text-slate-900">
          G
        </span>
      )}
      Войти через Google
    </Button>
  );
}
