import type { Locator, Page } from "playwright";

import {
  VcPublisherError,
  type VcPublisherLogContext,
} from "@/platforms/vc/types";

export async function humanDelay(min = 300, max = 1200) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export function logVcStep(
  step: string,
  context: Partial<VcPublisherLogContext> & Record<string, unknown> = {},
) {
  console.log("[vc-publisher]", {
    step,
    ...context,
  });
}

export function logVcError(
  step: string,
  error: unknown,
  context: Partial<VcPublisherLogContext> & Record<string, unknown> = {},
) {
  console.error("[vc-publisher:error]", {
    step,
    ...context,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
}

export async function withVcRetry<T>(
  label: string,
  action: (attempt: number) => Promise<T>,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      await humanDelay(350, 900);
    }
  }

  throw new VcPublisherError(
    504,
    "VC_INTERACTION_FAILED",
    lastError instanceof Error
      ? `VC interaction "${label}" failed after retries: ${lastError.message}`
      : `VC interaction "${label}" failed after retries.`,
  );
}

export async function waitForVisible(locator: Locator, label: string) {
  try {
    await locator.first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

    return locator.first();
  } catch (error) {
    throw new VcPublisherError(
      504,
      "VC_SELECTOR_NOT_FOUND",
      error instanceof Error
        ? `Unable to find visible VC element "${label}": ${error.message}`
        : `Unable to find visible VC element "${label}".`,
    );
  }
}

export async function safeScroll(locator: Locator, label: string) {
  const element = await waitForVisible(locator, label);

  await element.scrollIntoViewIfNeeded({ timeout: 10_000 });

  return element;
}

export async function safeClick(
  locator: Locator,
  label: string,
  context?: VcPublisherLogContext | null,
) {
  await withVcRetry(label, async (attempt) => {
    logVcStep("click_started", {
      ...(context ?? {}),
      label,
      attempt,
    });

    const element = await safeScroll(locator, label);

    await element.waitFor({ state: "visible", timeout: 10_000 });
    await element
      .waitFor({
        state: "attached",
        timeout: 10_000,
      })
      .catch(() => undefined);
    await element.evaluate((node) => {
      const htmlElement = node as HTMLElement;
      const disabled =
        htmlElement.getAttribute("disabled") !== null ||
        htmlElement.getAttribute("aria-disabled") === "true";

      if (disabled) {
        throw new Error("Element is disabled.");
      }
    });
    await element.hover({ timeout: 10_000 });
    await humanDelay(240, 620);
    await element.click({ timeout: 10_000 });
    await humanDelay(450, 950);

    logVcStep("click_finished", {
      ...(context ?? {}),
      label,
      attempt,
    });
  });
}

export async function safeFocus(
  locator: Locator,
  label: string,
  context?: VcPublisherLogContext | null,
) {
  return withVcRetry(label, async (attempt) => {
    const element = await safeScroll(locator, label);

    await element.hover({ timeout: 10_000 });
    await humanDelay(180, 420);
    await element.click({ timeout: 10_000 });
    await humanDelay(180, 420);
    await element.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.focus();
      }
    });

    logVcStep("field_focused", {
      ...(context ?? {}),
      label,
      attempt,
    });

    return element;
  });
}

export async function moveMouseLikeHuman(page: Page, locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) {
    await locator.hover({ timeout: 10_000 });
    return;
  }

  const targetX = box.x + box.width / 2 + Math.floor(Math.random() * 10) - 5;
  const targetY = box.y + box.height / 2 + Math.floor(Math.random() * 10) - 5;
  const startX = Math.max(12, targetX - 80 - Math.floor(Math.random() * 120));
  const startY = Math.max(12, targetY - 40 - Math.floor(Math.random() * 80));

  await page.mouse.move(startX, startY, { steps: 8 });
  await humanDelay(160, 420);
  await page.mouse.move(targetX, targetY, {
    steps: 18 + Math.floor(Math.random() * 12),
  });
}
