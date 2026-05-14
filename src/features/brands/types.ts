import type { BrandStatus } from "@prisma/client";

export type BrandListItem = {
  id: string;
  name: string;
  slug: string;
  siteUrl: string;
  domain: string;
  description: string | null;
  industry: string | null;
  geography: string | null;
  targetAudience: string | null;
  primaryCta: string | null;
  status: BrandStatus;
  assetCount: number;
  publicationCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
};

export type BrandOption = {
  id: string;
  name: string;
  domain: string;
};

export type CreateBrandPayload = {
  name: string;
  siteUrl: string;
  description?: string;
  industry?: string;
  geography?: string;
  targetAudience?: string;
  primaryCta?: string;
};

export type UpdateBrandPayload = Partial<CreateBrandPayload>;
