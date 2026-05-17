import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "FlowPost Agent для Windows",
};

export default function WindowsDownloadsPage() {
  const downloadUrl = process.env.NEXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-primary text-sm font-medium uppercase">
        FlowPost Desktop Agent
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        FlowPost Agent для Windows
      </h1>
      <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
        Приложение открывает браузер на вашем компьютере, чтобы FlowPost мог
        подключать площадки и выполнять публикации через ваш аккаунт.
      </p>

      <div className="mt-10 grid gap-5">
        <Section title="Перед скачиванием">
          <p>
            FlowPost Agent сейчас находится в раннем доступе. На Windows при
            первом запуске может появиться предупреждение SmartScreen, потому
            что текущая сборка пока не подписана сертификатом разработчика. В
            будущих версиях мы добавим официальную подпись приложения.
          </p>
        </Section>

        <Section title="Что делает Agent">
          <BulletList
            items={[
              "открывает отдельный браузер для задач FlowPost;",
              "помогает подключать Dzen, VC.ru и другие площадки;",
              "выполняет публикации через ваш аккаунт;",
              "показывает статус подключения и задач;",
              "позволяет удалить локальные данные браузера.",
            ]}
          />
        </Section>

        <Section title="Что важно знать">
          <BulletList
            items={[
              "Agent работает на вашем компьютере;",
              "сессии площадок хранятся в локальном профиле Agent;",
              "пароли от площадок не отправляются в FlowPost;",
              "Agent выполняет только задачи, созданные в вашем аккаунте;",
              "вы можете отключить Agent и удалить локальный профиль.",
            ]}
          />
        </Section>

        <TrustSection />

        <details className="border-border/70 bg-card/70 rounded-2xl border p-6">
          <summary className="cursor-pointer text-2xl font-semibold">
            Если Windows показала предупреждение
          </summary>
          <div className="text-muted-foreground mt-5 space-y-4 text-base leading-7">
            <ol className="grid gap-3">
              {[
                'Нажмите “Подробнее”.',
                'Нажмите “Выполнить в любом случае”.',
                "Запустите FlowPost Agent.",
                "Введите код подключения из кабинета FlowPost.",
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="bg-primary/12 text-primary grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </details>

        <section className="border-border/70 bg-card/70 rounded-2xl border p-6">
          {downloadUrl ? (
            <Link href={downloadUrl} className={buttonVariants()}>
              Скачать FlowPost Agent для Windows
            </Link>
          ) : (
            <span
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "cursor-not-allowed opacity-60",
              )}
              aria-disabled="true"
            >
              Сборка для Windows скоро будет доступна
            </span>
          )}
        </section>
      </div>

      <footer className="text-muted-foreground mt-10 flex flex-wrap gap-5 text-sm">
        <Link href="/">Назад к FlowPost</Link>
        <Link href="/contacts">Контакты</Link>
        <Link href="/privacy">Политика конфиденциальности</Link>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border/70 bg-card/70 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-4 text-base leading-7">
        {children}
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <Section title="Ваши данные под контролем">
      <p>
        FlowPost Agent нужен только для запуска отдельного браузера и выполнения
        задач публикации, которые вы создаете в своем аккаунте. Вы можете
        отключить Agent и удалить локальный профиль браузера в любой момент.
      </p>
      <BulletList
        items={[
          "Agent не получает доступ к вашему основному браузеру.",
          "Agent использует отдельный профиль браузера FlowPost.",
          "Пароли от площадок не отправляются в FlowPost.",
          "Сессии площадок используются только для задач публикации.",
          "Локальный профиль можно удалить в настройках Agent.",
        ]}
      />
    </Section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
