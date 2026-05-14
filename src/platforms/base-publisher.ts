export type PublisherOpenOptions = {
  userId: string;
};

export interface BasePublisher {
  open(options: PublisherOpenOptions): Promise<void>;
  launch(): Promise<void>;
  navigateToEditor(): Promise<void>;
  fillTitle(title: string): Promise<void>;
  fillContent(content: string): Promise<void>;
  publish(): Promise<void>;
  close(): Promise<void>;
  getCurrentEditorUrl(): string | null;
  getPublishedUrl(): string | null;
}
