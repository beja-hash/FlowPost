import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const apiUrl = process.env.FLOWPOST_API_URL?.replace(/\/$/, "");
const agentToken = process.env.FLOWPOST_AGENT_TOKEN;
const pollIntervalMs = Number(
  process.env.FLOWPOST_AGENT_POLL_INTERVAL_MS ?? 3000,
);

if (!apiUrl) {
  console.error("FLOWPOST_API_URL is required.");
  process.exit(1);
}

if (!agentToken) {
  console.error("FLOWPOST_AGENT_TOKEN is required.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `FlowPost API error ${response.status}`,
    );
  }

  return body;
}

async function updateStatus(jobId, status, extra = {}) {
  await request(`/api/agent/jobs/${jobId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status,
      ...extra,
    }),
  });
}

async function log(jobId, message, level = "info") {
  console.log(`[${jobId}] ${message}`);

  try {
    await request(`/api/agent/jobs/${jobId}/logs`, {
      method: "POST",
      body: JSON.stringify({ message, level }),
    });
  } catch (error) {
    console.warn(`[${jobId}] Failed to send log: ${error.message}`);
  }
}

function profilePath(platform) {
  return path.join(os.homedir(), ".flowpost", "browser-profiles", platform);
}

async function installFinishButton(context, jobId) {
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });

  await context.exposeBinding("__flowPostAgentFinish", () => {
    finish("completed");
  });

  await context.addInitScript(() => {
    const install = () => {
      if (document.getElementById("__flowpost_agent_finish")) {
        return;
      }

      const button = document.createElement("button");
      button.id = "__flowpost_agent_finish";
      button.type = "button";
      button.textContent = "Готово: сохранить подключение";
      button.style.position = "fixed";
      button.style.right = "20px";
      button.style.bottom = "20px";
      button.style.zIndex = "2147483647";
      button.style.border = "0";
      button.style.borderRadius = "999px";
      button.style.padding = "12px 18px";
      button.style.background = "#111827";
      button.style.color = "#ffffff";
      button.style.font = "600 14px system-ui, sans-serif";
      button.style.boxShadow = "0 18px 50px rgba(0, 0, 0, 0.32)";
      button.style.cursor = "pointer";
      button.addEventListener("click", () => {
        void window.__flowPostAgentFinish?.();
      });

      document.documentElement.appendChild(button);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install);
      return;
    }

    install();
  });

  context.on("close", () => {
    finish("closed");
  });

  await log(jobId, "Finish button installed. Waiting for user login.");
  return finished;
}

async function runConnectPlatformJob(job) {
  const platform = job.platform ?? job.payload?.platform;
  const connectUrl = job.payload?.connectUrl;

  if (!platform || !connectUrl) {
    throw new Error("connect_platform job is missing platform/connectUrl.");
  }

  const userDataDir = profilePath(platform);
  await mkdir(userDataDir, { recursive: true });

  await updateStatus(job.id, "running");
  await log(job.id, `Launching local Chromium for ${platform}.`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--start-maximized"],
    viewport: null,
  });

  const finished = await installFinishButton(context, job.id);
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(connectUrl, { waitUntil: "domcontentloaded" });
  await updateStatus(job.id, "waiting_user_login");
  await log(
    job.id,
    "Browser opened locally. User should log in and click the FlowPost finish button.",
  );

  const outcome = await finished;

  if (outcome !== "completed") {
    throw new Error("Browser was closed before connection was confirmed.");
  }

  await updateStatus(job.id, "completed", {
    result: {
      platform,
      profilePath: userDataDir,
      cookiesStoredLocally: true,
    },
  });
  await log(job.id, "Connection completed. Cookies stayed on this computer.");
  await context.close();
}

async function runPublishArticleJob(job) {
  const platform = job.platform ?? job.payload?.platform;
  const editorUrl = job.payload?.editorUrl;

  if (!platform || !editorUrl) {
    throw new Error("publish_article job is missing platform/editorUrl.");
  }

  const userDataDir = profilePath(platform);
  await mkdir(userDataDir, { recursive: true });

  await updateStatus(job.id, "running");
  await log(job.id, `Opening local browser for publish job on ${platform}.`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--start-maximized"],
    viewport: null,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await updateStatus(job.id, "waiting_user_login");
  await log(
    job.id,
    "Publish automation is not fully implemented in MVP. Browser is open for manual continuation.",
  );
}

async function handleJob(job) {
  await log(job.id, `Picked up job ${job.type}.`);

  if (job.type === "connect_platform") {
    await runConnectPlatformJob(job);
    return;
  }

  if (job.type === "publish_article") {
    await runPublishArticleJob(job);
    return;
  }

  throw new Error(`Unsupported job type: ${job.type}`);
}

console.log("FlowPost Agent started.");
console.log(`API: ${apiUrl}`);
console.log(
  "Cookies and platform sessions stay in ~/.flowpost/browser-profiles.",
);

while (true) {
  try {
    const { job } = await request("/api/agent/jobs/next");

    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      await handleJob(job);
    } catch (error) {
      await updateStatus(job.id, "failed", {
        error: error instanceof Error ? error.message : "Unknown agent error.",
      });
      await log(
        job.id,
        error instanceof Error ? error.message : "Unknown agent error.",
        "error",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await sleep(pollIntervalMs);
  }
}
