export function normalizeHttpUrl(input: string) {
  const trimmed = input.trim();

  let candidate = trimmed;

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  const url = new URL(candidate);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ссылка должна использовать HTTP или HTTPS.");
  }

  url.hash = "";

  if (url.pathname === "/") {
    url.pathname = "";
  }

  return url.toString().replace(/\/$/, "");
}

export function getDomainFromUrl(input: string) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? input;
  }
}
