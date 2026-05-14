export type DashboardPlatformAnalytics = {
  key: "dzen" | "vc" | "rbk";
  name: string;
  totalPublications: number;
  successfulPublications: number;
  failedPublications: number;
  scheduledPublications: number;
  successRate: number;
  lastPublicationAt: string | null;
  trackedClicks: number;
  indicator: "healthy" | "watch" | "quiet";
};

export type DashboardBrandAnalytics = {
  id: string;
  name: string;
  articleCount: number;
  publicationCount: number;
  successRate: number;
  recentActivityAt: string | null;
};

export type DashboardActivityItem = {
  id: string;
  kind: "published" | "failed" | "generated" | "scheduled";
  message: string;
  occurredAt: string;
};

export type DashboardTimelinePoint = {
  label: string;
  total: number;
  successful: number;
  failed: number;
};

export type DashboardOverview = {
  totalBrands: number;
  totalArticles: number;
  totalPublications: number;
  successfulPublications: number;
  failedPublications: number;
  scheduledPublications: number;
  successRate: number;
  trackedClicks: number;
  nextDistributionAt: string | null;
  lastActivityAt: string | null;
  platformAnalytics: DashboardPlatformAnalytics[];
  brandAnalytics: DashboardBrandAnalytics[];
  recentActivity: DashboardActivityItem[];
  publicationsOverTime: DashboardTimelinePoint[];
};
