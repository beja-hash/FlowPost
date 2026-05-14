export type VcPublisherLogContext = {
  userId: string;
  platform: "vc";
  sessionPath: string;
  profilePath: string;
};

export class VcPublisherError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VcPublisherError";
  }
}
