const assert = require("node:assert/strict");
const test = require("node:test");

const {
  inspectPublishingBody,
  resolvePublishCta,
  sanitizeBodyForPublishing,
} = require("../src/publish-body-sanitizer");

const cases = [
  {
    name: "trailing customer CTA and URL",
    options: { ctaText: "MyProduct", ctaUrl: "https://myproduct.com" },
    body: "Если хотите, можно посмотреть MyProduct.\n\nMyProduct\n\nhttps://myproduct.com",
    expected: "Если хотите, можно посмотреть MyProduct.",
  },
  {
    name: "markdown customer CTA link",
    options: { ctaText: "MyProduct", ctaUrl: "https://myproduct.com" },
    body: "Если хотите, можно посмотреть [MyProduct](https://myproduct.com).",
    expected: "Если хотите, можно посмотреть MyProduct.",
  },
  {
    name: "trailing customer URL",
    options: { ctaText: "MyProduct", ctaUrl: "https://myproduct.com" },
    body: "Если хотите, можно посмотреть MyProduct.\n\nhttps://myproduct.com",
    expected: "Если хотите, можно посмотреть MyProduct.",
  },
  {
    name: "junk CTA line",
    options: { ctaText: "MyProduct", ctaUrl: "https://myproduct.com" },
    body: "Если хотите, можно посмотреть MyProduct.\n\nпокупка услуг",
    expected: "Если хотите, можно посмотреть MyProduct.",
  },
  {
    name: "clean customer body",
    options: { ctaText: "MyProduct", ctaUrl: "https://myproduct.com" },
    body: "Если хотите, можно посмотреть MyProduct.",
    expected: "Если хотите, можно посмотреть MyProduct.",
  },
  {
    name: "brand metadata trailing CTA",
    options: { brandName: "ClientBrand", brandUrl: "https://clientbrand.ru" },
    body: "Платформа ClientBrand помогает автоматизировать публикации.\n\nClientBrand\n\nhttps://clientbrand.ru",
    expected: "Платформа ClientBrand помогает автоматизировать публикации.",
  },
  {
    name: "site name clean body",
    options: { siteName: "SiteName", websiteUrl: "https://site-name.example" },
    body: "Сервис SiteName помогает командам работать быстрее.",
    expected: "Сервис SiteName помогает командам работать быстрее.",
  },
  {
    name: "FlowPostAI remains ordinary customer metadata",
    options: {
      ctaText: "FlowPostAI",
      ctaUrl: "https://flowpost-3yxb.onrender.com",
    },
    body: "Если хотите, можно посмотреть FlowPostAI.\n\nFlowPostAI\n\nhttps://flowpost-3yxb.onrender.com",
    expected: "Если хотите, можно посмотреть FlowPostAI.",
  },
];

for (const { name, options, body, expected } of cases) {
  test(`sanitizes ${name}`, () => {
    const { anchorText, url } = resolvePublishCta(options);
    const cleanBody = sanitizeBodyForPublishing(body, {
      ...options,
      anchorText,
      url,
    });
    const diagnostics = inspectPublishingBody(cleanBody, {
      ...options,
      anchorText,
      url,
    });

    assert.equal(cleanBody, expected);
    assert.equal(diagnostics.tail, expected);
    assert.equal(diagnostics.containsPlainUrl, false);
    assert.equal(diagnostics.containsMarkdownLink, false);
    assert.equal(diagnostics.containsTrailingCta, false);
  });
}

test("resolves customer CTA metadata in publish priority order", () => {
  assert.deepEqual(
    resolvePublishCta({
      productName: "MyProduct",
      brandName: "BrandFallback",
      brandUrl: "https://brand.example",
    }),
    { anchorText: "MyProduct", url: "https://brand.example" },
  );
  assert.deepEqual(
    resolvePublishCta({
      siteName: "SiteName",
      websiteUrl: "https://site.example",
    }),
    { anchorText: "SiteName", url: "https://site.example" },
  );
  assert.deepEqual(resolvePublishCta({}), { anchorText: null, url: null });
});

test("does not invent or delete a single unmatched customer product name", () => {
  assert.equal(
    sanitizeBodyForPublishing("MyProduct", {
      anchorText: "MyProduct",
      url: "https://myproduct.com",
    }),
    "MyProduct",
  );
});

test("removes all supported standalone junk CTA lines", () => {
  const body =
    "Сервис MyProduct помогает командам.\n\nоформить\n\nпереходите\n\nподробнее по ссылке";

  assert.equal(
    sanitizeBodyForPublishing(body, {
      anchorText: "MyProduct",
      url: "https://myproduct.com",
    }),
    "Сервис MyProduct помогает командам.",
  );
});
