import { Check, HelpCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlanSelectButton } from "@/features/billing/components/plan-select-button";
import { billingPlans, type BillingPlan } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const faq = [
  {
    question: "Можно ли сменить тариф позже?",
    answer: "Да, тариф можно будет изменить.",
  },
  {
    question: "Что значит 170/300/500 статей?",
    answer: "Это месячный лимит публикаций на VC.ru и Дзен суммарно.",
  },
  {
    question: "Какой результат даёт сервис?",
    answer:
      "FlowPost помогает регулярно выпускать и адаптировать статьи для VC.ru и Дзена, тестировать темы и видеть, какие материалы получают охваты и переходы.",
  },
  {
    question: "Чем отличается поддержка?",
    answer:
      "В Стандарте обращения идут в общей очереди. В Middle и Premium — приоритетная экспресс-поддержка 24/7.",
  },
];

export function PricingPlansPage() {
  return (
    <div className="relative mx-auto w-full max-w-[1400px] px-6 py-16 sm:px-8 lg:px-12 lg:py-24">
      <div className="pointer-events-none absolute inset-x-8 top-10 -z-10 h-72 rounded-full bg-primary/8 blur-3xl" />

      <section className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.55fr)] lg:items-end">
        <div>
          <Badge className="mb-6 bg-primary/12 text-primary">
            AI Content Distribution Platform
          </Badge>
          <h1 className="font-heading max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-6xl">
            Выберите тариф
          </h1>
          <p className="text-muted-foreground mt-6 max-w-4xl text-lg leading-8">
            Запускайте регулярную публикацию статей на VC.ru и Дзене:
            генерация, адаптация, автопубликация и аналитика в одном сервисе.
          </p>
        </div>

        <div className="rounded-[2rem] border border-primary/15 bg-primary/10 p-7 shadow-[0_30px_90px_-58px_rgba(83,109,254,0.8)]">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Sparkles className="size-6" />
            </span>
            <div>
              <p className="text-lg font-semibold">Ранний доступ</p>
              <p className="text-muted-foreground mt-2 text-base leading-7">
                Специальные цены для первых пользователей до 1 августа.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-14 grid items-stretch gap-6 lg:grid-cols-3">
        {billingPlans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </section>

      <section className="mt-14 rounded-[2rem] border border-border/30 bg-card/55 p-8 sm:p-10">
        <div className="mb-8 flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <HelpCircle className="size-6" />
          </span>
          <h2 className="font-heading text-3xl font-semibold tracking-[-0.04em]">
            Вопросы перед выбором
          </h2>
        </div>
        <div className="grid gap-7 md:grid-cols-2">
          {faq.map((item) => (
            <div key={item.question} className="border-t border-border/30 pt-6">
              <h3 className="text-lg font-semibold">{item.question}</h3>
              <p className="text-muted-foreground mt-3 text-base leading-7">
                {item.answer}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({ plan }: { plan: BillingPlan }) {
  const isPremium = plan.id === "premium";

  return (
    <Card
      className={cn(
        "relative h-full rounded-[2.25rem] border-border/40 bg-card/76 py-8 transition-all duration-300 hover:-translate-y-1.5 hover:border-border hover:shadow-[0_36px_110px_-56px_rgba(15,23,42,0.78)]",
        plan.highlighted &&
          "border-primary/55 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-primary)_12%,var(--color-card)),var(--color-card)_76%)] shadow-[0_40px_130px_-58px_rgba(83,109,254,0.78)] ring-primary/15 lg:scale-[1.025]",
        isPremium &&
          "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-foreground)_8%,var(--color-card)),var(--color-card)_78%)]",
      )}
    >
      <CardHeader className="gap-6 px-8 lg:px-9">
        <div className="flex min-h-8 flex-wrap gap-2">
          {plan.badges.map((badge) => (
            <Badge
              key={badge}
              variant={badge === "Популярный выбор" ? "default" : "outline"}
              className={cn(
                badge === "Популярный выбор" &&
                  "bg-primary text-primary-foreground",
              )}
            >
              {badge}
            </Badge>
          ))}
        </div>
        <div>
          <CardTitle className="text-3xl tracking-[-0.05em]">
            {plan.name}
          </CardTitle>
          <CardDescription className="mt-3 min-h-14 text-base leading-7">
            {plan.description}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-8 lg:px-9">
        <div className="space-y-3">
          <p className="text-muted-foreground text-base">
            <span className="line-through">{plan.regularPrice}</span>
            <span className="ml-2">/ мес</span>
          </p>
          <div className="flex items-end gap-2">
            <span className="font-heading text-5xl font-bold tracking-[-0.07em]">
              {plan.earlyAccessPrice}
            </span>
            <span className="text-muted-foreground pb-2 text-base">/ мес</span>
          </div>
          <p className="text-muted-foreground text-sm leading-6">
            Цена раннего доступа действует до 1 августа.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <PlanMetric label="Статей" value={plan.articlesPerMonth.toString()} />
          <PlanMetric label="Проекты" value={plan.brands} />
        </div>

        <ul className="mt-8 space-y-4">
          {plan.features.map((feature) => (
            <li key={feature} className="flex gap-3 text-base leading-7">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <Check className="size-3.5" />
              </span>
              <span className="text-foreground/90">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-[1.4rem] bg-muted/35 p-5">
          <p className="text-base font-semibold">Поддержка</p>
          <p className="text-muted-foreground mt-2 text-base leading-7">
            {plan.support}
          </p>
        </div>

        <div className="mt-auto pt-8">
          <PlanSelectButton plan={plan} highlighted={plan.highlighted} />
        </div>
      </CardContent>
    </Card>
  );
}

function PlanMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] bg-muted/35 p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-2 text-base font-semibold leading-6">{value}</p>
    </div>
  );
}
