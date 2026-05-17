import { MarketingHeader } from "@/components/marketing/marketing-header";

type MarketingLayoutProps = {
  children: React.ReactNode;
};

export default function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main>{children}</main>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>FlowPost — платформа для подготовки и публикации материалов.</p>
          <p>Дашборд, карточки, таблицы, формы и адаптивные рабочие экраны.</p>
        </div>
      </footer>
    </div>
  );
}
