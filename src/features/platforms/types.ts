export type PlatformConnectionStatus =
  | "not_connected"
  | "connected"
  | "expired";

export type PlatformSlug = "dzen" | "vc";

export type PlatformConnection = {
  id: string;
  name: string;
  platform: PlatformSlug;
  status: PlatformConnectionStatus;
};
