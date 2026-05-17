import Link from "next/link";

import { contractorInfo, legalNavLinks, serviceInfo } from "@/lib/legal";

export function MarketingFooter() {
  return (
    <footer className="border-border/60 bg-card/30 border-t">
      <div className="text-muted-foreground mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 text-sm sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
        <div className="max-w-2xl space-y-3">
          <p className="text-foreground font-semibold">FlowPost</p>
          <p>
            Онлайн-сервис для генерации, планирования и публикации статей на
            внешних контент-платформах. Услуга оказывается дистанционно,
            доставка физического товара не осуществляется.
          </p>
          <p>
            Исполнитель: {contractorInfo.name}, {contractorInfo.status}. ИНН{" "}
            {contractorInfo.inn}.
          </p>
          <p>
            Поддержка:{" "}
            <a
              href={`mailto:${serviceInfo.supportEmail}`}
              className="text-foreground underline-offset-4 hover:underline"
            >
              {serviceInfo.supportEmail}
            </a>
            {" · "}
            <a
              href={`tel:${serviceInfo.phone.replace(/\D/g, "")}`}
              className="text-foreground underline-offset-4 hover:underline"
            >
              {serviceInfo.phone}
            </a>
          </p>
        </div>
        <nav className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
          {legalNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
