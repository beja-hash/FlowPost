"use client";

import Link from "next/link";
import {
  CreditCard,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { signOut } from "next-auth/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserMenuProps = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  image?: string | null;
  collapsed?: boolean;
};

function getInitials(name?: string | null, email?: string | null) {
  const fallback = name ?? email ?? "U";

  return fallback
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatRole(role?: string | null) {
  if (role === "ACTIVE") {
    return "Активен";
  }

  if (role === "SUSPENDED") {
    return "Ограничен";
  }

  return role;
}

export function UserMenu({
  name,
  email,
  role,
  image,
  collapsed = false,
}: UserMenuProps) {
  const initials = getInitials(name, email);
  const displayName = name ?? "Пользователь";
  const displayEmail = email ?? "Аккаунт";
  const menuContent = (
    <DropdownMenuContent
      align="end"
      sideOffset={10}
      className="border-border/70 bg-popover/96 w-72 rounded-2xl border p-2 shadow-[0_24px_80px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <div className="px-2 py-2">
        <div className="flex items-center gap-3">
          <Avatar className="border-border/80 size-10 border">
            <AvatarImage src={image ?? undefined} alt={displayName} />
            <AvatarFallback className="bg-muted text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">
              {displayName}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {displayEmail}
            </p>
          </div>
        </div>
      </div>
      <DropdownMenuSeparator className="my-2" />
      <DropdownMenuItem
        render={<Link href="/settings/profile" />}
        className="gap-3 rounded-xl px-2.5 py-2.5"
      >
        <User />
        Профиль
      </DropdownMenuItem>
      <DropdownMenuItem
        render={<Link href="/settings/billing" />}
        className="gap-3 rounded-xl px-2.5 py-2.5"
      >
        <CreditCard />
        Подписка
      </DropdownMenuItem>
      <DropdownMenuItem
        render={<Link href="/settings" />}
        className="gap-3 rounded-xl px-2.5 py-2.5"
      >
        <Settings />
        Настройки
      </DropdownMenuItem>
      <DropdownMenuSeparator className="my-2" />
      <DropdownMenuItem
        onClick={() => void signOut({ callbackUrl: "/" })}
        variant="destructive"
        className="gap-3 rounded-xl px-2.5 py-2.5"
      >
        <LogOut />
        Выйти
      </DropdownMenuItem>
      <div className="border-border/60 bg-muted/35 text-muted-foreground mt-2 rounded-xl border px-3 py-2 text-[0.72rem] leading-5">
        <ShieldCheck className="mr-1.5 inline size-3.5" />
        Аккаунт защищён через вход Google.
      </div>
    </DropdownMenuContent>
  );

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="focus-visible:ring-ring/30 rounded-full transition-transform duration-200 hover:scale-105 focus-visible:ring-4 focus-visible:outline-none"
              aria-label="Открыть меню аккаунта"
            />
          }
        >
          <Avatar className="border-sidebar-border/70 size-10 border">
            <AvatarImage src={image ?? undefined} alt={name ?? "Пользователь"} />
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        {menuContent}
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="group/account border-border/65 bg-card/60 hover:border-border hover:bg-muted/55 focus-visible:ring-ring/30 inline-flex max-w-[220px] items-center gap-3 rounded-2xl border px-2.5 py-1.5 text-left shadow-[0_14px_40px_-30px_rgba(15,23,42,0.75)] transition-all duration-200 focus-visible:ring-4 focus-visible:outline-none"
            aria-label="Открыть меню аккаунта"
          />
        }
      >
        <Avatar className="border-border/80 size-9 border shadow-sm">
          <AvatarImage src={image ?? undefined} alt={displayName} />
          <AvatarFallback className="bg-muted text-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="hidden min-w-0 sm:block">
          <p className="text-foreground max-w-32 truncate text-sm font-medium">
            {displayName}
          </p>
          <p className="text-muted-foreground max-w-32 truncate text-xs">
            {formatRole(role) ?? displayEmail}
          </p>
        </div>
      </DropdownMenuTrigger>
      {menuContent}
    </DropdownMenu>
  );
}
