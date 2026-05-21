import type {
  AssetStatus,
  PublicationStatus,
  TopicIntent,
  VariantStatus,
} from "@prisma/client";

export type ContentFormat =
  | "teardown"
  | "case_story"
  | "failure_story"
  | "personal_experience"
  | "comparison"
  | "guide"
  | "opinion"
  | "myth_busting"
  | "checklist"
  | "mistakes"
  | "trend_analysis"
  | "decision_guide";

export type ArticleTone =
  | "calm_expert"
  | "direct"
  | "provocative_soft"
  | "painful"
  | "founder_style"
  | "analytical"
  | "practical";

export type ArticleContentBrief = {
  contentFormat?: ContentFormat | "";
  tone?: ArticleTone | "";
  targetAudience?: string;
  readerPain?: string;
  mainThesis?: string;
};

export type PlatformOption = {
  id: string;
  name: string;
  slug: string;
};

export type DistributionAssetListItem = {
  id: string;
  title: string;
  slug: string;
  canonicalBody: string;
  summary: string | null;
  primaryKeyword: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  intent: TopicIntent | null;
  contentBrief: ArticleContentBrief | null;
  status: AssetStatus;
  brandId: string;
  brandName: string;
  brandDomain: string;
  brandUrl: string;
  platformId: string;
  platformName: string;
  platformSlug: string;
  variantId: string;
  variantStatus: VariantStatus;
  publicationId: string | null;
  publicationStatus: PublicationStatus;
  publicationLastError: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  clickCount: number;
  leadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateDistributionAssetPayload = {
  title: string;
  canonicalBody: string;
  brandId: string;
  platformId: string;
  summary?: string;
  primaryKeyword?: string;
  ctaText?: string;
  ctaUrl?: string;
  intent?: TopicIntent | null;
  contentBrief?: ArticleContentBrief | null;
  scheduledAt?: string | null;
};

export type UpdateDistributionAssetPayload =
  Partial<CreateDistributionAssetPayload> & {
    status?: AssetStatus;
    publicationStatus?: PublicationStatus;
  };
