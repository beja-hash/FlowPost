const apiUrl = document.getElementById("apiUrl");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");
const statusNode = document.getElementById("status");
const profileRoot = document.getElementById("profileRoot");
const browserCachePath = document.getElementById("browserCachePath");
const connectionStatus = document.getElementById("connectionStatus");
const account = document.getElementById("account");
const prepareBrowser = document.getElementById("prepareBrowser");
const disconnectButton = document.getElementById("disconnect");
const deleteProfilesButton = document.getElementById("deleteProfiles");
const openProfilesButton = document.getElementById("openProfiles");
let operation = "idle";

const userSafeFallbacks = {
  pair: "Не удалось подключить Agent.",
  browser: "Не удалось открыть браузер. Закройте старое окно браузера и попробуйте снова.",
  profiles: "Не удалось выполнить действие с локальными профилями.",
};

function setStatus(message) {
  statusNode.textContent = message || "";
}

function setOperation(nextOperation) {
  operation = nextOperation;
  const busy = operation === "connecting" || operation === "launching_browser";
  pairButton.disabled = busy || operation === "connecting";
  prepareBrowser.disabled = busy || operation === "launching_browser";
  disconnectButton.disabled = busy;
  deleteProfilesButton.disabled = busy;
  openProfilesButton.disabled = busy;
}

function normalizeError(error, fallback) {
  const message = error?.message || "";

  if (/object has been destroyed/i.test(message)) {
    return "Не удалось открыть браузер. Закройте старое окно браузера и попробуйте снова.";
  }

  if (/browser.*closed|context.*closed|page.*closed|target.*closed/i.test(message)) {
    return "Браузер был закрыт. Нажмите “Открыть браузер” еще раз.";
  }

  return message || fallback;
}

function applyState(state) {
  apiUrl.value = state.apiUrl || apiUrl.value;
  profileRoot.textContent = state.profileRoot || "";
  browserCachePath.textContent = state.browserCachePath || "";
  connectionStatus.textContent =
    state.status || (state.connected ? "connected" : "disconnected");
  account.textContent = state.account || "не подключен";
  prepareBrowser.hidden = state.browserInstallStatus !== "failed";
  if (state.status === "preparing_browser") {
    setOperation("launching_browser");
    setStatus("FlowPost подготавливает браузер для публикации...");
  }
  if (state.status === "launching_browser" || state.status === "browser_opening") {
    setOperation("launching_browser");
  }
  if (state.status === "browser_opened") {
    setOperation("connected");
  }
  if (state.status === "connected" || state.connected) {
    setOperation("connected");
  }
  if (state.status === "error") {
    setOperation("error");
  }
  if (state.error) setStatus(normalizeError(state.error, userSafeFallbacks.browser));
}

window.flowPostAgent.getState().then(applyState);
window.flowPostAgent.onState(applyState);
window.flowPostAgent.onLog((log) => setStatus(log.message));

pairButton.addEventListener("click", async () => {
  if (operation === "connecting") return;
  setOperation("connecting");
  setStatus("Подключаем Agent...");
  try {
    const result = await window.flowPostAgent.pair({
      apiUrl: apiUrl.value,
      code: pairingCode.value,
    });
    applyState({
      connected: true,
      account: result.device?.name,
      status: "connected",
    });
    setStatus("Agent подключен. Ожидаем задачи FlowPost.");
  } catch (error) {
    setOperation("error");
    setStatus(normalizeError(error, userSafeFallbacks.pair));
    return;
  }
  setOperation("connected");
});

prepareBrowser.addEventListener("click", async () => {
  if (operation === "launching_browser") return;
  setOperation("launching_browser");
  prepareBrowser.hidden = true;
  setStatus("FlowPost подготавливает браузер для публикации...");
  try {
    await window.flowPostAgent.prepareBrowser();
    setStatus("Браузер готов к публикации.");
  } catch (error) {
    prepareBrowser.hidden = false;
    setOperation("error");
    setStatus(normalizeError(error, "Не удалось подготовить браузер."));
    return;
  }
  setOperation("connected");
});

disconnectButton.addEventListener("click", async () => {
  if (operation === "connecting" || operation === "launching_browser") return;
  setOperation("connecting");
  try {
    await window.flowPostAgent.disconnect();
    applyState({ connected: false, account: null, status: "disconnected" });
    setStatus("Agent отключен.");
  } catch (error) {
    setOperation("error");
    setStatus(normalizeError(error, "Не удалось отключить Agent."));
    return;
  }
  setOperation("idle");
});

deleteProfilesButton.addEventListener("click", async () => {
  if (operation === "connecting" || operation === "launching_browser") return;
  setOperation("connecting");
  try {
    await window.flowPostAgent.deleteProfiles();
    setStatus("Локальные данные браузера удалены.");
  } catch (error) {
    setOperation("error");
    setStatus(normalizeError(error, userSafeFallbacks.profiles));
    return;
  }
  setOperation("connected");
});

openProfilesButton.addEventListener("click", async () => {
  if (operation === "connecting" || operation === "launching_browser") return;
  setOperation("connecting");
  try {
    await window.flowPostAgent.openProfiles();
  } catch (error) {
    setOperation("error");
    setStatus(normalizeError(error, userSafeFallbacks.profiles));
    return;
  }
  setOperation("connected");
});
