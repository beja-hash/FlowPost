const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const plainUrlPattern = /https?:\/\/[^\s)\]}>"']+/gi;
const plainUrlTestPattern = /https?:\/\/[^\s)\]}>"']+/i;
const markdownLinkTestPattern = /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/i;
const junkCtaLinePattern =
  /^(?:покупка услуг|купить|заказать|перейти по ссылке|ссылка ниже|оформить|переходите(?: по ссылке)?|подробнее по ссылке)\s*[:.!?]?$/i;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeValue(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function resolvePublishCta(payload = {}) {
  const brand =
    payload.brand && typeof payload.brand === "object" ? payload.brand : {};

  const anchorText =
    normalizeValue(payload.ctaText) ||
    normalizeValue(payload.productName) ||
    normalizeValue(payload.brandName) ||
    normalizeValue(payload.siteName) ||
    normalizeValue(brand.name) ||
    null;
  const url =
    normalizeValue(payload.ctaUrl) ||
    normalizeValue(payload.brandUrl) ||
    normalizeValue(payload.websiteUrl) ||
    normalizeValue(brand.website) ||
    normalizeValue(brand.url) ||
    null;

  return { anchorText, url };
}

function ctaTextCandidates(options = {}) {
  const candidates = [
    options.anchorText,
    options.ctaText,
    options.productName,
    options.brandName,
    options.siteName,
    options.brand?.name,
  ]
    .map(normalizeValue)
    .filter(Boolean);

  return Array.from(new Set(candidates));
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
  const candidates = ctaTextCandidates(options);
  const lines = normalizeText(source).split("\n");
  trimBlankTail(lines);
  const lastLine = String(lines[lines.length - 1] || "").trim();

  return {
    tail: bodyTail(source),
    containsPlainUrl: plainUrlTestPattern.test(source),
    containsMarkdownLink: markdownLinkTestPattern.test(source),
    containsTrailingCta: candidates.some((candidate) =>
      new RegExp(`^${escapeRegExp(candidate)}$`, "i").test(lastLine),
    ),
  };
}

function sanitizeBodyForPublishing(body, options = {}) {
  const candidates = ctaTextCandidates(options);
  let cleanBody = normalizeText(body)
    .replace(markdownLinkPattern, "$1")
    .replace(plainUrlPattern, "");
  const lines = cleanBody
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line) => !junkCtaLinePattern.test(line.trim()));

  trimBlankTail(lines);

  while (lines.length > 0) {
    const lastLine = String(lines[lines.length - 1] || "").trim();
    const trailingCandidate = candidates.find((candidate) =>
      new RegExp(`^${escapeRegExp(candidate)}$`, "i").test(lastLine),
    );

    if (!trailingCandidate) {
      break;
    }

    const precedingBody = lines.slice(0, -1).join("\n");
    if (!new RegExp(escapeRegExp(trailingCandidate), "i").test(precedingBody)) {
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
  resolvePublishCta,
  sanitizeBodyForPublishing,
};
