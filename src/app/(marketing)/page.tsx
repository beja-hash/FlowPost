import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  "Генерация статей под задачи бренда",
  "Планирование публикаций и управление проектами",
  "Адаптация материалов под VC.ru и Дзен",
  "Аналитика статей и поддержка регулярного выпуска",
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <section className="mx-auto grid min-h-[calc(100vh-76px)] w-full max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:px-8 lg:py-20">
        <div>
          <p className="text-primary text-sm font-medium tracking-[0.22em] uppercase">
            B2B SaaS для контент-маркетинга
          </p>
          <h1 className="mt-5 max-w-4xl text-5xl leading-[0.98] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            FlowPost
          </h1>
          <p className="text-muted-foreground mt-6 max-w-3xl text-lg leading-8">
            Онлайн-сервис для генерации, планирования и публикации статей на
            внешних контент-платформах. Клиент получает доступ к личному
            кабинету, управлению брендами, публикациями и платформами в рамках
            выбранного тарифа.
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
        </div>

        <aside className="border-border/60 bg-card/70 rounded-2xl border p-6 shadow-[0_34px_100px_-70px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-3">
            <span className="bg-primary/12 text-primary grid size-11 place-items-center rounded-xl">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Электронная услуга</p>
              <p className="text-muted-foreground text-sm">
                Доступ предоставляется на 30 календарных дней
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            {features.map((feature) => (
              <div key={feature} className="flex gap-3 text-sm leading-6">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
          <div className="bg-muted/35 text-muted-foreground mt-6 rounded-xl p-4 text-sm leading-6">
            Физическая доставка не осуществляется. Оплата подписки проводится
            через платежного партнера Robokassa.
          </div>
        </aside>
      </section>

      <section
        id="features"
        className="border-border/60 bg-card/25 border-t px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-3">
          {[
            [
              "Для кого",
              "B2B SaaS, онлайн-сервисы, предприниматели и команды, которым нужен поток статей для органического трафика.",
            ],
            [
              "Что продается",
              "Ежемесячный доступ к личному кабинету FlowPost и функциям генерации, планирования и управления контентом.",
            ],
            [
              "Срок доступа",
              "30 календарных дней с момента успешной оплаты выбранного тарифа.",
            ],
          ].map(([title, text]) => (
            <div
              key={title}
              className="border-border/60 bg-card/70 rounded-2xl border p-6"
            >
              <h2 className="text-xl font-semibold tracking-[-0.03em]">
                {title}
              </h2>
              <p className="text-muted-foreground mt-3 text-base leading-7">
                {text}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
