const brokenUtf8Pattern = /\uFFFD|��/;

export class VcTextError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VcTextError";
  }
}

function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function assertValidVcText(value: string, label: string) {
  if (brokenUtf8Pattern.test(value)) {
    throw new VcTextError(
      "VC_BROKEN_UTF8",
      `VC ${label} contains broken UTF-8 replacement characters.`,
    );
  }
}

export function sanitizeVcTitle(title: string) {
  const normalized = normalizeLineBreaks(title).normalize("NFC").trim();

  assertValidVcText(normalized, "title");

  return normalized.replace(/\s+/g, " ");
}

export function sanitizeVcBody(content: string) {
  const normalized = normalizeLineBreaks(content).normalize("NFC");

  assertValidVcText(normalized, "body");

  return normalized
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/g, "")
        .replace(/^\s*[-*+]\s+/g, "")
        .replace(/^\s*\d+\.\s+/g, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trimEnd(),
    )
    .join("\n")
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
