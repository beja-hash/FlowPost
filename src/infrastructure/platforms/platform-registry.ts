import { DistributionPlatformType } from "@prisma/client";

export const platformSlugs = ["dzen", "vc"] as const;

export type PlatformSlug = (typeof platformSlugs)[number];

export type PlatformMetadata = {
  supportsMarkdown: boolean;
  supportsImages: boolean;
  requiresCaptchaHandling: boolean;
  supportsScheduling: boolean;
};

export type PlatformSelectorConfig = {
  title?: string[];
  body?: string[];
  publish?: string[];
};

export type PlatformConfig = {
  id: PlatformSlug;
  slug: PlatformSlug;
  type: DistributionPlatformType;
  name: string;
  icon: string;
  connectUrl: string;
  editorUrl: string;
  description: string;
  styleGuide: string;
  selectors: PlatformSelectorConfig;
  metadata: PlatformMetadata;
};

export const platformRegistry = {
  dzen: {
    id: "dzen",
    slug: "dzen",
    type: DistributionPlatformType.DZEN,
    name: "Dzen",
    icon: "D",
    connectUrl: "https://dzen.ru",
    editorUrl: "https://dzen.ru",
    description:
      "Нарративная платформа для широкого органического охвата русскоязычной аудитории.",
    styleGuide:
      "Живой экспертный текст, сильный заход, понятные абзацы и нативная интеграция продукта без прямой рекламы.",
    selectors: {},
    metadata: {
      supportsMarkdown: false,
      supportsImages: true,
      requiresCaptchaHandling: true,
      supportsScheduling: false,
    },
  },
  vc: {
    id: "vc",
    slug: "vc",
    type: DistributionPlatformType.VC,
    name: "VC.ru",
    icon: "V",
    connectUrl: "https://vc.ru",
    editorUrl: "https://vc.ru/new",
    description:
      "Площадка для предпринимателей, операторов и продуктовых команд.",
    styleGuide:
      "Практичный бизнес-разбор, конкретика, прозрачная логика и опытный операторский тон.",
    selectors: {},
    metadata: {
      supportsMarkdown: false,
      supportsImages: true,
      requiresCaptchaHandling: true,
      supportsScheduling: false,
    },
  },
} satisfies Record<PlatformSlug, PlatformConfig>;

export const platforms = platformSlugs.map((slug) => platformRegistry[slug]);

export function getPlatformConfig(platform: string) {
  const normalized = platform.trim().toLowerCase();
  const config = platforms.find(
    (item) =>
      item.id === normalized ||
      item.slug === normalized ||
      item.name.toLowerCase() === normalized,
  );

  return config ?? null;
}
