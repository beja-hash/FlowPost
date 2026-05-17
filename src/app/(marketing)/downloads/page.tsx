import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Скачать FlowPost Agent",
};

export default function DownloadsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-primary text-sm font-medium uppercase">
        FlowPost Desktop Agent
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        Скачать FlowPost Agent
      </h1>
      <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
        Agent открывает отдельный браузер на вашем компьютере, чтобы FlowPost
        мог подключать площадки и выполнять публикации через ваш аккаунт.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <DownloadCard
          title="macOS"
          subtitle="macOS Apple Silicon"
          href="/downloads/mac"
        />
        <DownloadCard
          title="Windows"
          subtitle="Windows 10/11"
          href="/downloads/windows"
        />
      </div>

      <section className="border-border/70 bg-card/70 mt-10 rounded-2xl border p-6">
        <h2 className="text-2xl font-semibold">Зачем нужна инструкция</h2>
        <div className="text-muted-foreground mt-4 max-w-3xl text-base leading-7">
          FlowPost Agent сейчас находится в раннем доступе. Перед скачиванием
          мы коротко объясняем, как установить приложение и что делать при
          первом запуске, если macOS или Windows попросит дополнительное
          подтверждение.
        </div>
      </section>
    </div>
  );
}

function DownloadCard({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <div className="border-border/70 bg-card/70 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        {subtitle}
      </p>
      <Link href={href} className={cn(buttonVariants(), "mt-5")}>
        Инструкция и скачивание
      </Link>
    </div>
  );
}
