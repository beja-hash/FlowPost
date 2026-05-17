import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Layers3,
  Lightbulb,
  Megaphone,
  PackageCheck,
  PenLine,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { billingPlans } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const serviceFeatures = [
  "Генерация статей под задачи бренда",
  "Планирование публикаций",
  "Адаптация материалов под VC.ru и Дзен",
  "Управление брендами, публикациями и платформами",
  "Аналитика и поддержка регулярного выпуска",
];

const productCards = [
  {
    icon: Lightbulb,
    title: "Анализирует продукт и нишу",
    text: "Помогает описать бренд, аудиторию и темы, чтобы контент был связан с задачами бизнеса.",
  },
  {
    icon: PenLine,
    title: "Генерирует статьи и темы",
    text: "Создает темы, брифы, заголовки и материалы для регулярного выпуска на внешних площадках.",
  },
  {
    icon: Megaphone,
    title: "Помогает публиковать материалы",
    text: "Адаптирует статьи под формат площадок и поддерживает процесс публикации через браузер клиента.",
  },
];

const audienceCards = [
  {
    icon: Building2,
    title: "B2B SaaS",
    text: "Для команд, которым нужен постоянный поток статей вокруг продукта, кейсов и рынка.",
  },
  {
    icon: Layers3,
    title: "Онлайн-сервисы",
    text: "Для продуктов, которые хотят быстрее тестировать темы и получать органический спрос.",
  },
  {
    icon: Rocket,
    title: "Предприниматели",
    text: "Для основателей и экспертов, которым важно регулярно появляться на внешних площадках.",
  },
  {
    icon: Users,
    title: "Команды маркетинга",
    text: "Для маркетологов, которым нужен управляемый процесс генерации, публикации и анализа.",
  },
];

const workflowSteps = [
  {
    title: "Добавьте бренд",
    text: "Опишите продукт, аудиторию, тональность и площадки для публикаций.",
  },
  {
    title: "Сгенерируйте темы и статьи",
    text: "Получите идеи, брифы, заголовки и тексты под выбранную задачу.",
  },
  {
    title: "Адаптируйте материал",
    text: "Подготовьте статью под формат VC.ru, Дзена и выбранных контент-платформ.",
  },
  {
    title: "Опубликуйте и отслеживайте",
    text: "Управляйте публикациями и смотрите, какие материалы дают отклик.",
  },
];

const paymentFacts = [
  "Услуга оказывается дистанционно",
  "Физическая доставка не осуществляется",
  "Доступ предоставляется на 30 календарных дней",
  "Условия возврата указаны на странице “Возврат и отказ от услуги”",
  "Оплата проводится через Robokassa",
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <section className="mx-auto grid w-full max-w-[1500px] gap-12 px-4 pt-10 pb-18 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_520px] lg:items-start lg:px-10 lg:pt-18 lg:pb-24 xl:gap-16">
        <div className="max-w-5xl">
          <p className="text-primary text-sm font-medium uppercase">
            B2B SaaS для контент-дистрибуции
          </p>
          <h1 className="mt-5 text-5xl leading-none font-semibold sm:text-7xl lg:text-8xl">
            FlowPost
          </h1>
          <p className="text-muted-foreground mt-7 max-w-4xl text-xl leading-9 sm:text-2xl sm:leading-10">
            Генерируйте, планируйте и публикуйте статьи на внешних площадках,
            чтобы получать органический трафик быстрее, чем через классическое
            SEO.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}
            >
              Смотреть тарифы
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contacts"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 px-6",
              )}
            >
              Контакты
            </Link>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              ["30 дней", "доступ к личному кабинету после оплаты"],
              ["170–500", "статей в месяц в зависимости от тарифа"],
              ["VC.ru + Дзен", "площадки для регулярной дистрибуции"],
            ].map(([value, label]) => (
              <div
                key={value}
                className="border-border/60 bg-card/55 rounded-2xl border p-5"
              >
                <p className="text-2xl font-semibold">{value}</p>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <aside className="border-border/60 bg-card/70 rounded-3xl border p-7 shadow-[0_42px_140px_-90px_rgba(0,0,0,0.95)] sm:p-8 lg:mt-2">
          <div className="flex items-start gap-4">
            <span className="bg-primary/12 text-primary grid size-13 shrink-0 place-items-center rounded-2xl">
              <ShieldCheck className="size-6" />
            </span>
            <div>
              <p className="text-2xl font-semibold">Что входит в сервис</p>
              <p className="text-muted-foreground mt-2 text-base leading-7">
                Ежемесячный доступ к личному кабинету и инструментам управления
                контентом.
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-5">
            {serviceFeatures.map((feature) => (
              <div key={feature} className="flex gap-3 text-base leading-7">
                <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-400" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          <div className="border-border/50 bg-muted/30 text-muted-foreground mt-8 rounded-2xl border p-5 text-base leading-7">
            Услуга предоставляется в электронном виде. Доступ к сервису — 30
            календарных дней. Оплата через Robokassa.
          </div>
        </aside>
      </section>

      <section
        id="features"
        className="border-border/60 bg-card/25 border-y px-4 py-16 sm:px-6 lg:px-10"
      >
        <div className="mx-auto max-w-[1500px]">
          <SectionHeading
            eyebrow="Возможности"
            title="Что делает FlowPost"
            text="Сервис закрывает путь от идеи до публикации: помогает найти тему, подготовить материал и вести регулярную контент-дистрибуцию."
          />
          <div className="mt-9 grid gap-5 lg:grid-cols-3">
            {productCards.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[1500px]">
          <SectionHeading
            eyebrow="Аудитория"
            title="Для кого"
            text="FlowPost подходит тем, кто продает сложный продукт и хочет регулярно объяснять его ценность через внешние контент-площадки."
          />
          <div className="mt-9 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {audienceCards.map((card) => (
              <FeatureCard key={card.title} {...card} compact />
            ))}
          </div>
        </div>
      </section>

      <section className="border-border/60 bg-card/25 border-y px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[1500px]">
          <SectionHeading
            eyebrow="Процесс"
            title="Как работает"
            text="Внутри FlowPost контент собирается в понятный рабочий процесс: от настройки бренда до публикации и анализа."
          />
          <div className="mt-10 grid gap-5 lg:grid-cols-4">
            {workflowSteps.map((step, index) => (
              <div
                key={step.title}
                className="border-border/60 bg-card/70 rounded-2xl border p-6"
              >
                <span className="bg-primary/12 text-primary grid size-10 place-items-center rounded-xl text-sm font-semibold">
                  {index + 1}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
                <p className="text-muted-foreground mt-3 text-base leading-7">
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-[1500px] gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <SectionHeading
              eyebrow="Тарифы"
              title="Выберите объем публикаций"
              text="На странице тарифов указаны стоимость, лимиты, срок доступа и состав услуг для каждого плана."
            />
            <Link
              href="/pricing"
              className={cn(buttonVariants({ size: "lg" }), "mt-8 h-12 px-6")}
            >
              Перейти к тарифам
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {billingPlans.map((plan) => (
              <div
                key={plan.id}
                className="border-border/60 bg-card/70 rounded-2xl border p-5"
              >
                <p className="text-lg font-semibold">{plan.name}</p>
                <p className="mt-3 text-3xl font-semibold">
                  {plan.earlyAccessPrice}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  за 30 календарных дней
                </p>
                <div className="text-muted-foreground mt-5 space-y-3 text-sm leading-6">
                  <p>{plan.articlesPerMonth} статей в месяц</p>
                  <p>{plan.brands}</p>
                  <p>{plan.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-border/60 bg-card/25 border-t px-4 py-16 sm:px-6 lg:px-10">
        <div className="border-border/60 bg-card/70 mx-auto grid max-w-[1500px] gap-8 rounded-3xl border p-7 sm:p-8 lg:grid-cols-[0.8fr_1.2fr] lg:p-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="bg-primary/12 text-primary grid size-12 place-items-center rounded-2xl">
                <PackageCheck className="size-6" />
              </span>
              <p className="text-primary text-sm font-medium uppercase">
                Для оплаты
              </p>
            </div>
            <h2 className="mt-5 text-4xl leading-tight font-semibold">
              Информация для оплаты
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-7">
              Этот блок фиксирует условия услуги для клиента и платежной
              модерации.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {paymentFacts.map((fact) => (
              <div
                key={fact}
                className="border-border/50 bg-muted/25 flex gap-3 rounded-2xl border p-4 text-base leading-7"
              >
                <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-400" />
                <span>
                  {fact.includes("Возврат") ? (
                    <>
                      Условия возврата указаны на странице{" "}
                      <Link
                        href="/refund"
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        Возврат и отказ от услуги
                      </Link>
                    </>
                  ) : (
                    fact
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="max-w-4xl">
      <p className="text-primary text-sm font-medium uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">
        {title}
      </h2>
      <p className="text-muted-foreground mt-4 text-lg leading-8">{text}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  text,
  compact = false,
}: {
  icon: typeof Sparkles;
  title: string;
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border/60 bg-card/70 rounded-2xl border p-6",
        !compact && "min-h-[250px] p-7",
      )}
    >
      <span className="bg-primary/12 text-primary grid size-12 place-items-center rounded-2xl">
        <Icon className="size-6" />
      </span>
      <h3 className="mt-6 text-2xl leading-tight font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-4 text-base leading-7">{text}</p>
    </div>
  );
}
