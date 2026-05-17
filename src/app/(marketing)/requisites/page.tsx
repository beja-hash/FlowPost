import {
  DetailList,
  LegalPage,
  LegalSection,
} from "@/components/marketing/legal-page";
import { contractorInfo, serviceInfo } from "@/lib/legal";

export const metadata = {
  title: "Реквизиты",
};

export default function RequisitesPage() {
  return (
    <LegalPage title="Реквизиты">
      <LegalSection title="Сведения об исполнителе">
        <DetailList
          items={[
            { label: "Исполнитель", value: contractorInfo.name },
            { label: "Статус", value: contractorInfo.status },
            { label: "ИНН", value: contractorInfo.inn },
            {
              label: "Дата постановки на учет",
              value: contractorInfo.npdRegistrationDate,
            },
            { label: "ИФНС", value: contractorInfo.taxOffice },
            {
              label: "Email",
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
          ]}
        />
      </LegalSection>
      <LegalSection title="Расчеты">
        <p>
          Банковские реквизиты не публикуются на сайте. Расчеты за доступ к
          FlowPost проходят через платежного партнера Robokassa.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
