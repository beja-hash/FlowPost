import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Megaphone,
  Orbit,
  Plug,
  Rocket,
  Settings,
} from "lucide-react";

export type SidebarLink = {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

export const sidebarLinks: SidebarLink[] = [
  {
    title: "Дашборд",
    href: "/dashboard",
    description: "Главные показатели.",
    icon: LayoutDashboard,
  },
  {
    title: "Бренды",
    href: "/brands",
    description: "Сайты и продукты клиентов.",
    icon: Orbit,
  },
  {
    title: "Публикации",
    href: "/distribution",
    description: "Статьи и площадки.",
    icon: Megaphone,
  },
  {
    title: "Стратегия",
    href: "/strategy",
    description: "Контент-автопилот.",
    icon: Rocket,
  },
  {
    title: "Платформы",
    href: "/platforms",
    description: "Подключение площадок.",
    icon: Plug,
  },
  {
    title: "Аккаунт",
    href: "/settings",
    description: "Профиль, подписка и настройки.",
    icon: Settings,
  },
];
