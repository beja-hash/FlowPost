const assert = require("node:assert/strict");
const test = require("node:test");

const {
  inspectPublishingBody,
  sanitizeBodyForPublishing,
} = require("../src/publish-body-sanitizer");

const options = {
  ctaText: "FlowPostAI",
  ctaUrl: "https://flowpost-3yxb.onrender.com",
};
const expected = "Если хотите, можно посмотреть FlowPostAI.";

const cases = [
  [
    "trailing CTA and URL",
    `${expected}\n\nFlowPostAI\n\nhttps://flowpost-3yxb.onrender.com`,
  ],
  [
    "markdown CTA link",
    "Если хотите, можно посмотреть [FlowPostAI](https://flowpost-3yxb.onrender.com).",
  ],
  ["trailing URL", `${expected}\n\nhttps://flowpost-3yxb.onrender.com`],
  ["junk CTA line", `${expected}\n\nпокупка услуг`],
  ["clean body", expected],
];

for (const [name, body] of cases) {
  test(`sanitizes ${name}`, () => {
    const cleanBody = sanitizeBodyForPublishing(body, options);
    assert.equal(cleanBody, expected);
    assert.deepEqual(inspectPublishingBody(cleanBody, options), {
      tail: expected,
      containsPlainUrl: false,
      containsMarkdownLink: false,
      containsTrailingCta: false,
    });
  });
}
