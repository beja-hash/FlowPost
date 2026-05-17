import {
  DetailList,
  LegalPage,
  LegalSection,
} from "@/components/marketing/legal-page";
import { serviceInfo } from "@/lib/legal";

export const metadata = {
  title: "Контакты",
};

export default function ContactsPage() {
  return (
    <LegalPage title="Контакты">
      <LegalSection title="Связь с FlowPost">
        <DetailList
          items={[
            { label: "Сервис", value: serviceInfo.name },
            {
              label: "Email поддержки",
              value: (
                <a href={`mailto:${serviceInfo.supportEmail}`}>
                  {serviceInfo.supportEmail}
                </a>
              ),
            },
            {
              label: "Телефон",
              value: <a href="tel:+79959007122">{serviceInfo.phone}</a>,
            },
            { label: "Telegram", value: serviceInfo.telegram },
            { label: "Регион", value: serviceInfo.region },
          ]}
        />
      </LegalSection>
      <LegalSection title="Обработка обращений">
        <p>
          По вопросам оплаты, доступа к сервису, возврата и технической
          поддержки пишите на email.
        </p>
        <p>
          Обращения обрабатываются ежедневно, обычно в течение 1–2 рабочих дней.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
