const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const plainUrlPattern = /https?:\/\/[^\s)\]}>"']+/gi;
const plainUrlTestPattern = /https?:\/\/[^\s)\]}>"']+/i;
const markdownLinkTestPattern = /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/i;
const junkCtaLinePattern =
  /^(?:покупка услуг|купить|заказать|перейти по ссылке|переходите по ссылке|ссылка ниже)\s*[:.!?]?$/i;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function resolveCtaText(options = {}) {
  return String(options.ctaText || options.brandName || "FlowPostAI")
    .replace(/\s+/g, " ")
    .trim();
}

function trimBlankTail(lines) {
  while (lines.length > 0 && !String(lines[lines.length - 1] || "").trim()) {
    lines.pop();
  }
}

function bodyTail(body, limit = 1000) {
  return String(body || "").slice(-limit);
}

function inspectPublishingBody(body, options = {}) {
  const source = String(body || "");
  const ctaText = resolveCtaText(options);
  const lines = normalizeText(source).split("\n");
  trimBlankTail(lines);
  const lastLine = String(lines[lines.length - 1] || "").trim();
  const ctaOnlyPattern = ctaText
    ? new RegExp(`^${escapeRegExp(ctaText)}$`, "i")
    : null;

  return {
    tail: bodyTail(source),
    containsPlainUrl: plainUrlTestPattern.test(source),
    containsMarkdownLink: markdownLinkTestPattern.test(source),
    containsTrailingCta: Boolean(ctaOnlyPattern && ctaOnlyPattern.test(lastLine)),
  };
}

function sanitizeBodyForPublishing(body, options = {}) {
  const ctaText = resolveCtaText(options);
  const ctaOnlyPattern = ctaText
    ? new RegExp(`^${escapeRegExp(ctaText)}$`, "i")
    : null;
  let cleanBody = normalizeText(body)
    .replace(markdownLinkPattern, "$1")
    .replace(plainUrlPattern, "");
  const lines = cleanBody
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line) => !junkCtaLinePattern.test(line.trim()));

  trimBlankTail(lines);

  while (
    ctaOnlyPattern &&
    lines.length > 0 &&
    ctaOnlyPattern.test(String(lines[lines.length - 1] || "").trim())
  ) {
    const precedingBody = lines.slice(0, -1).join("\n");
    if (!new RegExp(escapeRegExp(ctaText), "i").test(precedingBody)) {
      break;
    }

    lines.pop();
    trimBlankTail(lines);
  }

  cleanBody = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleanBody;
}

module.exports = {
  bodyTail,
  inspectPublishingBody,
  sanitizeBodyForPublishing,
};
