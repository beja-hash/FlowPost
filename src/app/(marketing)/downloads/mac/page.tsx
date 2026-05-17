import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { PairingCodeCard } from "@/features/agent/components/pairing-code-card";
import { auth } from "@/infrastructure/auth/session";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "FlowPost Agent для macOS",
};

export default async function MacDownloadsPage() {
  const downloadUrl = process.env.NEXT_PUBLIC_AGENT_MAC_DOWNLOAD_URL;
  const session = await auth();

  return (
    <DownloadGuide
      title="FlowPost Agent для macOS"
      intro="Приложение открывает браузер на вашем компьютере, чтобы FlowPost мог подключать площадки и выполнять публикации через ваш аккаунт."
      beforeTitle="Перед скачиванием"
      beforeText="FlowPost Agent сейчас находится в раннем доступе. На macOS при первом запуске может появиться предупреждение о том, что приложение не удалось проверить. Это связано с тем, что текущая сборка пока не подписана через Apple Developer ID. Мы уже подготовили архитектуру Agent и позже добавим официальную подпись приложения."
      guideTitle="Как открыть на macOS, если появилось предупреждение"
      guideIntro="Если macOS покажет предупреждение при первом запуске:"
      steps={[
        'Нажмите “Готово” в окне предупреждения.',
        'Откройте “Системные настройки”.',
        'Перейдите в “Конфиденциальность и безопасность”.',
        'Внизу страницы найдите сообщение о FlowPost Agent.',
        'Нажмите “Открыть всё равно”.',
        'Подтвердите запуск приложения.',
      ]}
      guideNote="Это действие нужно сделать только при первом запуске текущей beta-версии."
      downloadUrl={downloadUrl}
      downloadLabel="Скачать FlowPost Agent для macOS"
      unavailableLabel="Сборка для macOS скоро будет доступна"
      isAuthenticated={Boolean(session?.user?.id)}
    />
  );
}

function DownloadGuide({
  title,
  intro,
  beforeTitle,
  beforeText,
  guideTitle,
  guideIntro,
  steps,
  guideNote,
  downloadUrl,
  downloadLabel,
  unavailableLabel,
  isAuthenticated,
}: {
  title: string;
  intro: string;
  beforeTitle: string;
  beforeText: string;
  guideTitle: string;
  guideIntro: string;
  steps: string[];
  guideNote: string;
  downloadUrl?: string;
  downloadLabel: string;
  unavailableLabel: string;
  isAuthenticated: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-primary text-sm font-medium uppercase">
        FlowPost Desktop Agent
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        {title}
      </h1>
      <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
        {intro}
      </p>

      <div className="mt-10 grid gap-5">
        <Section title={beforeTitle}>
          <p>{beforeText}</p>
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

        <PairingCodeCard isAuthenticated={isAuthenticated} />

        <details className="border-border/70 bg-card/70 rounded-2xl border p-6">
          <summary className="cursor-pointer text-2xl font-semibold">
            {guideTitle}
          </summary>
          <div className="text-muted-foreground mt-5 space-y-4 text-base leading-7">
            <p>{guideIntro}</p>
            <ol className="grid gap-3">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="bg-primary/12 text-primary grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p>{guideNote}</p>
          </div>
        </details>

        <section className="border-border/70 bg-card/70 rounded-2xl border p-6">
          {downloadUrl ? (
            <Link href={downloadUrl} className={buttonVariants()}>
              {downloadLabel}
            </Link>
          ) : (
            <span
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "cursor-not-allowed opacity-60",
              )}
              aria-disabled="true"
            >
              {unavailableLabel}
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
