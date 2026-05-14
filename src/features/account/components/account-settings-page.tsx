import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Gauge,
  Mail,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/saas/status-badge";
import { BillingActionButtons, AccountSessionActions } from "@/features/account/components/account-actions";
import { ProfileNameForm } from "@/features/account/components/profile-name-form";
import { getWorkspaceShell } from "@/features/workspaces/server/workspace-service";
import { requireSession } from "@/infrastructure/auth/session";
import { prisma } from "@/infrastructure/db/prisma";
import { cn } from "@/lib/utils";

type AccountTab = "profile" | "billing" | "settings";

const tabs: Array<{ value: AccountTab; label: string; href: string }> = [
  { value: "profile", label: "Профиль", href: "/settings/profile" },
  { value: "billing", label: "Подписка и биллинг", href: "/settings/billing" },
  { value: "settings", label: "Настройки", href: "/settings" },
];

function formatDate(date?: Date | null, withTime = false) {
  if (!date) {
    return "Не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {}),
  }).format(date);
}

function formatPlan(plan?: string | null) {
  if (plan === "STARTER") {
    return "Старт";
  }

  if (plan === "PRO") {
    return "Про";
  }

  return "Рост";
}

function quotaForPlan(plan?: string | null) {
  if (plan === "STARTER") {
    return 20;
  }

  if (plan === "PRO") {
    return 250;
  }

  return 80;
}

function formatUserStatus(status?: string | null) {
  if (status === "ACTIVE") {
    return "Активен";
  }

  if (status === "SUSPENDED") {
    return "Ограничен";
  }

  if (status === "INVITED") {
    return "Приглашён";
  }

  return "Неизвестно";
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Пользователь";
  return source
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function usageTone(usagePercent: number) {
  if (usagePercent >= 90) {
    return "bg-red-500";
  }

  if (usagePercent >= 70) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

export async function AccountSettingsPage({ activeTab }: { activeTab: AccountTab }) {
  const session = await requireSession();
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        image: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        timezone: true,
        locale: true,
        emailVerified: true,
      },
    }),
    getWorkspaceShell(session.user.id),
  ]);

  const quota = quotaForPlan(workspace?.plan);
  const used = workspace
    ? await prisma.publication.count({ where: { workspaceId: workspace.id } })
    : 0;
  const remaining = Math.max(quota - used, 0);
  const usagePercent = Math.min(Math.round((used / quota) * 100), 100);
  const displayName = user?.name ?? session.user.name ?? "Пользователь";
  const displayEmail = user?.email ?? session.user.email ?? "Не указано";
  const initials = getInitials(displayName, displayEmail);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 pb-10">
      <header className="flex flex-col gap-5 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm font-medium">Settings / Аккаунт</p>
          <h1 className="font-heading text-4xl font-semibold tracking-[-0.04em]">
            Управление аккаунтом
          </h1>
        </div>
        <nav className="bg-muted/45 flex w-full gap-1 rounded-2xl p-1 sm:w-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={tab.href}
              className={cn(
                "text-muted-foreground hover:text-foreground flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-medium transition-all duration-200 sm:flex-none",
                activeTab === tab.value &&
                  "bg-background text-foreground shadow-[0_10px_30px_-24px_rgba(15,23,42,0.75)]",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="rounded-[2rem] border border-border/25 bg-card/58 shadow-[0_28px_90px_-60px_rgba(15,23,42,0.55)] backdrop-blur">
        {activeTab === "profile" ? (
          <ProfileSection
            displayName={displayName}
            displayEmail={displayEmail}
            image={user?.image ?? session.user.image}
            initials={initials}
            status={user?.status}
            createdAt={user?.createdAt}
            lastLoginAt={user?.lastLoginAt}
          />
        ) : null}

        {activeTab === "billing" ? (
          <BillingSection
            plan={workspace?.plan}
            used={used}
            remaining={remaining}
            quota={quota}
            usagePercent={usagePercent}
          />
        ) : null}

        {activeTab === "settings" ? (
          <SettingsSection
            workspaceName={workspace?.name}
            workspaceRole={workspace?.role}
            timezone={user?.timezone}
            locale={user?.locale}
            emailVerified={user?.emailVerified}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProfileSection({
  displayName,
  displayEmail,
  image,
  initials,
  status,
  createdAt,
  lastLoginAt,
}: {
  displayName: string;
  displayEmail: string;
  image?: string | null;
  initials: string;
  status?: string | null;
  createdAt?: Date | null;
  lastLoginAt?: Date | null;
}) {
  return (
    <section className="space-y-8 p-6 sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <Avatar className="size-20 border border-border/40 shadow-[0_18px_46px_-28px_rgba(15,23,42,0.8)]">
            <AvatarImage src={image ?? undefined} alt={displayName} />
            <AvatarFallback className="bg-foreground text-xl font-semibold text-background">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-heading truncate text-3xl font-semibold tracking-[-0.04em]">
                {displayName}
              </h2>
              <StatusBadge tone={status === "ACTIVE" ? "positive" : "warning"}>
                {formatUserStatus(status)}
              </StatusBadge>
            </div>
            <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
              <Mail className="size-4" />
              {displayEmail}
            </p>
          </div>
        </div>
        <AccountSessionActions />
      </div>

      <div className="grid gap-6 border-y border-border/25 py-7 md:grid-cols-3">
        <AccountFact icon={Mail} label="Email" value={displayEmail} />
        <AccountFact
          icon={CalendarDays}
          label="Дата регистрации"
          value={formatDate(createdAt)}
        />
        <AccountFact
          icon={ShieldCheck}
          label="Последний вход"
          value={formatDate(lastLoginAt, true)}
        />
      </div>

      <div className="grid gap-3">
        <div>
          <h3 className="text-lg font-semibold">Имя в аккаунте</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Это имя отображается в меню и рабочих разделах продукта.
          </p>
        </div>
        <ProfileNameForm initialName={displayName} />
      </div>
    </section>
  );
}

function BillingSection({
  plan,
  used,
  remaining,
  quota,
  usagePercent,
}: {
  plan?: string | null;
  used: number;
  remaining: number;
  quota: number;
  usagePercent: number;
}) {
  return (
    <section className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-8 p-6 sm:p-8 lg:border-r lg:border-border/25">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-muted-foreground text-sm font-medium">Текущий план</p>
            <h2 className="font-heading mt-2 text-4xl font-semibold tracking-[-0.05em]">
              {formatPlan(plan)}
            </h2>
          </div>
          <StatusBadge tone="positive">Активен</StatusBadge>
        </div>

        <div className="rounded-[1.6rem] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_12%,transparent),transparent_62%)] p-6 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-sm">Использовано публикаций</p>
              <p className="mt-1 text-3xl font-semibold tracking-[-0.04em]">
                {used} <span className="text-muted-foreground text-base font-medium">из {quota}</span>
              </p>
            </div>
            <span className="text-muted-foreground text-sm">{usagePercent}%</span>
          </div>
          <div className="bg-background/70 h-3 overflow-hidden rounded-full">
            <div
              className={cn("h-full rounded-full transition-all duration-500", usageTone(usagePercent))}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <UsageMetric icon={Gauge} label="Использовано" value={used} />
          <UsageMetric icon={WalletCards} label="Осталось" value={remaining} />
          <UsageMetric icon={Sparkles} label="Общий лимит" value={quota} />
        </div>
      </div>

      <div className="space-y-7 p-6 sm:p-8">
        <div>
          <p className="text-muted-foreground text-sm font-medium">Управление подпиской</p>
          <h2 className="font-heading mt-2 text-2xl font-semibold tracking-[-0.04em]">
            План, оплата и отмена
          </h2>
        </div>
        <BillingActionButtons />
        <div className="grid gap-4 border-t border-border/25 pt-6">
          <AccountFact icon={CreditCard} label="Способ оплаты" value="Не подключён" />
          <AccountFact icon={CheckCircle2} label="Статус доступа" value="Доступ активен" />
        </div>
      </div>
    </section>
  );
}

function SettingsSection({
  workspaceName,
  workspaceRole,
  timezone,
  locale,
  emailVerified,
}: {
  workspaceName?: string | null;
  workspaceRole?: string | null;
  timezone?: string | null;
  locale?: string | null;
  emailVerified?: Date | null;
}) {
  return (
    <section className="space-y-8 p-6 sm:p-8">
      <div>
        <p className="text-muted-foreground text-sm font-medium">Настройки</p>
        <h2 className="font-heading mt-2 text-3xl font-semibold tracking-[-0.04em]">
          Параметры рабочего пространства
        </h2>
      </div>
      <div className="grid gap-6 border-y border-border/25 py-7 md:grid-cols-2">
        <AccountFact
          icon={Settings}
          label="Рабочее пространство"
          value={workspaceName ?? "Не указано"}
        />
        <AccountFact
          icon={ShieldCheck}
          label="Роль"
          value={workspaceRole === "OWNER" ? "Владелец" : workspaceRole ?? "Участник"}
        />
        <AccountFact icon={CalendarDays} label="Часовой пояс" value={timezone ?? "UTC"} />
        <AccountFact icon={UserRound} label="Язык" value={locale ?? "Русский"} />
      </div>
      <div className="rounded-[1.5rem] bg-muted/35 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-emerald-600 dark:text-emerald-300" />
          <div>
            <p className="font-medium">Вход через Google</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {emailVerified
                ? "Email подтверждён, аккаунт готов к работе."
                : "Аккаунт активен. Подтверждение email появится после ответа провайдера."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 truncate text-base font-semibold">{value}</p>
    </div>
  );
}

function UsageMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[1.35rem] bg-muted/35 p-5 transition-colors duration-200 hover:bg-muted/55">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}
