import type { PlatformSlug } from "@/infrastructure/platforms/platform-registry";

type PlatformFormat = "markdown" | "plainText";

export type ArticleContentCleanupOptions = {
  ctaText?: string | null;
  ctaUrl?: string | null;
  brandName?: string | null;
  brandUrl?: string | null;
  productBlockEnabled?: boolean;
};

const publishFormatByPlatform: Record<PlatformSlug, PlatformFormat> = {
  dzen: "plainText",
  vc: "plainText",
};

const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const bareUrlPattern = /https?:\/\/[^\s)]+/gi;
const standaloneUrlPattern = /^https?:\/\/\S+$/i;
const junkCtaLinePattern =
  /^(покупка услуг|покупка|услуги|купить|заказать|перейти по ссылке|переходите по ссылке|ссылка ниже|ссылка:?|cta:?|call to action:?|url:?)$/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInlineMarkdown(line: string) {
  return line
    .replace(markdownLinkPattern, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function normalizeCtaText(options: ArticleContentCleanupOptions) {
  const text = options.ctaText?.trim() || options.brandName?.trim() || "FlowPost";
  return text.replace(/\s+/g, " ");
}

function normalizeProductDescription(ctaText: string) {
  return `Если вы хотите системно публиковать контент на внешних площадках, можно посмотреть ${ctaText}. Сервис помогает планировать статьи, генерировать тексты и готовить публикации под разные каналы.`;
}

function paragraphLooksLikeProductBlock(
  paragraph: string,
  options: ArticleContentCleanupOptions,
) {
  const normalized = paragraph.toLowerCase();
  const ctaText = normalizeCtaText(options).toLowerCase();
  const ctaUrl = options.ctaUrl?.trim().toLowerCase();
  const brandUrl = options.brandUrl?.trim().toLowerCase();

  if (ctaUrl && normalized.includes(ctaUrl)) {
    return true;
  }

  if (brandUrl && normalized.includes(brandUrl)) {
    return true;
  }

  return (
    normalized.includes(ctaText) &&
    /flowpost|сервис|продукт|платформ|публиков|генерир|контент|канал|посмотреть/.test(
      normalized,
    )
  );
}

function removeTrailingJunk(lines: string[], ctaText: string) {
  const ctaOnlyPattern = new RegExp(`^${escapeRegExp(ctaText)}$`, "i");
  const next = [...lines];

  while (next.length > 0) {
    const last = next[next.length - 1]?.trim() ?? "";

    if (!last) {
      next.pop();
      continue;
    }

    if (
      standaloneUrlPattern.test(last) ||
      junkCtaLinePattern.test(last) ||
      ctaOnlyPattern.test(last)
    ) {
      next.pop();
      continue;
    }

    break;
  }

  return next;
}

export function cleanupGeneratedArticleContent(
  content: string,
  options: ArticleContentCleanupOptions = {},
) {
  const ctaText = normalizeCtaText(options);
  const productBlockEnabled = options.productBlockEnabled !== false;
  const withoutMarkdownLinks = content.replace(markdownLinkPattern, "$1");
  const withoutInlineBareUrls = withoutMarkdownLinks.replace(bareUrlPattern, "");
  const cleanedLines = withoutInlineBareUrls
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => stripInlineMarkdown(line).trim())
    .filter((line) => {
      if (!line) {
        return true;
      }

      return !standaloneUrlPattern.test(line) && !junkCtaLinePattern.test(line);
    });
  const trimmedLines = removeTrailingJunk(cleanedLines, ctaText);
  const paragraphs = trimmedLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !paragraphLooksLikeProductBlock(paragraph, options));

  if (productBlockEnabled) {
    paragraphs.push(normalizeProductDescription(ctaText));
  }

  return paragraphs
    .join("\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLeadSentence(text: string) {
  const match = text.match(/^([^.!?]{3,80}[.!?])\s+(.+)$/);

  if (!match) {
    return [text];
  }

  return [match[1], "", match[2]];
}

export function markdownToPlainArticle(content: string) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const output: string[] = [];
  let listIndex = 0;

  function pushBlank() {
    if (output[output.length - 1] !== "") {
      output.push("");
    }
  }

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      listIndex = 0;
      pushBlank();
      return;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);

    if (heading) {
      listIndex = 0;
      pushBlank();
      output.push(stripInlineMarkdown(heading[1]));
      pushBlank();
      return;
    }

    const unorderedItem = trimmed.match(/^[-*+]\s+(.+)$/);

    if (unorderedItem) {
      listIndex += 1;
      const item = stripInlineMarkdown(unorderedItem[1]);
      const split = splitLeadSentence(item);
      output.push(`${listIndex}. ${split[0]}`);

      if (split.length > 1) {
        output.push(...split.slice(1));
      }

      return;
    }

    const orderedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (orderedItem) {
      listIndex += 1;
      output.push(`${listIndex}. ${stripInlineMarkdown(orderedItem[1])}`);
      return;
    }

    listIndex = 0;
    output.push(stripInlineMarkdown(trimmed.replace(/^>\s+/, "")));
  });

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatArticleForPlatform(
  content: string,
  platform: PlatformSlug,
) {
  const format = publishFormatByPlatform[platform] ?? "plainText";

  if (format === "markdown") {
    return content.trim();
  }

  return markdownToPlainArticle(content);
}

export function hasUnsafeDzenMarkdown(content: string) {
  return /(^|\n)#{1,6}\s|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(
    content,
  );
}
