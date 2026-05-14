import type { PlatformSlug } from "@/infrastructure/platforms/platform-registry";

type PlatformFormat = "markdown" | "plainText";

const publishFormatByPlatform: Record<PlatformSlug, PlatformFormat> = {
  dzen: "plainText",
  vc: "plainText",
};

function stripInlineMarkdown(line: string) {
  return line
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
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
