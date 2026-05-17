import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Скачать FlowPost Agent",
};

export default function DownloadsPage() {
  const macDownloadUrl = process.env.NEXT_PUBLIC_AGENT_MAC_DOWNLOAD_URL;
  const windowsDownloadUrl = process.env.NEXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-primary text-sm font-medium uppercase">
        FlowPost Desktop Agent
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        Скачать FlowPost Agent
      </h1>
      <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
        Agent нужен, чтобы открыть браузер именно на вашем компьютере. Это
        позволяет использовать ваши аккаунты Dzen и VC.ru без передачи cookies,
        паролей и сессий площадок на сервер FlowPost.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <DownloadCard
          title="macOS Apple Silicon"
          href={macDownloadUrl}
          file="FlowPost Agent 0.1.0 arm64 DMG для M1/M2/M3/M4"
        />
        <DownloadCard
          title="Windows"
          href={windowsDownloadUrl}
          file="flowpost-agent-windows.exe"
        />
      </div>

      <section className="border-border/70 bg-card/70 mt-10 rounded-2xl border p-6">
        <h2 className="text-2xl font-semibold">FAQ</h2>
        <div className="text-muted-foreground mt-6 grid gap-5 text-base leading-7">
          <Faq
            question="Зачем нужен FlowPost Agent?"
            answer="Сайт FlowPost работает в облаке, но браузер для публикации должен открываться на вашем компьютере. Agent связывает ваш кабинет FlowPost с локальным браузером и выполняет задачи публикации через отдельный профиль."
          />
          <Faq
            question="Передаются ли мои пароли на сервер?"
            answer="Нет. FlowPost не запрашивает и не хранит пароли от Dzen, VC.ru и других площадок. Авторизация происходит внутри локального браузера на вашем компьютере."
          />
          <Faq
            question="Где хранятся cookies?"
            answer="Cookies и сессии площадок хранятся в отдельном локальном профиле FlowPost Agent на вашем устройстве."
          />
          <Faq
            question="Может ли FlowPost видеть мой основной браузер?"
            answer="Нет. Agent использует отдельный профиль браузера для задач FlowPost и не получает доступ к вашим личным вкладкам, истории и файлам."
          />
          <Faq
            question="Можно ли отключить Agent?"
            answer="Да. Agent можно отключить в любой момент, а локальные данные браузера можно удалить в настройках Agent."
          />
        </div>
      </section>
    </div>
  );
}

function DownloadCard({
  title,
  href,
  file,
}: {
  title: string;
  href?: string;
  file: string;
}) {
  return (
    <div className="border-border/70 bg-card/70 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        {href
          ? `Ссылка подготовлена под release-артефакт: ${file}`
          : `Скоро: ${file}`}
      </p>
      {href ? (
        <Link href={href} className={cn(buttonVariants(), "mt-5")}>
          Скачать
        </Link>
      ) : (
        <span
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "mt-5 cursor-not-allowed opacity-60",
          )}
          aria-disabled="true"
        >
          Скоро
        </span>
      )}
    </div>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="border-border/60 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-foreground font-semibold">{question}</h3>
      <p className="mt-2">{answer}</p>
    </div>
  );
}
