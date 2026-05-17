import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

type MarketingLayoutProps = {
  children: React.ReactNode;
};

export default function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <div className="dark bg-background text-foreground min-h-screen">
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
