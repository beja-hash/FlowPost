const apiUrl = document.getElementById("apiUrl");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");
const statusNode = document.getElementById("status");
const profileRoot = document.getElementById("profileRoot");
const browserCachePath = document.getElementById("browserCachePath");
const connectionStatus = document.getElementById("connectionStatus");
const account = document.getElementById("account");
const prepareBrowser = document.getElementById("prepareBrowser");

function setStatus(message) {
  statusNode.textContent = message || "";
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
    setStatus("FlowPost подготавливает браузер для публикации...");
  }
  if (state.error) setStatus(state.error);
}

window.flowPostAgent.getState().then(applyState);
window.flowPostAgent.onState(applyState);
window.flowPostAgent.onLog((log) => setStatus(log.message));

pairButton.addEventListener("click", async () => {
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
    setStatus(error?.message || "Не удалось подключить Agent.");
  }
});

prepareBrowser.addEventListener("click", async () => {
  prepareBrowser.hidden = true;
  setStatus("FlowPost подготавливает браузер для публикации...");
  try {
    await window.flowPostAgent.prepareBrowser();
    setStatus("Браузер готов к публикации.");
  } catch (error) {
    prepareBrowser.hidden = false;
    setStatus(error?.message || "Не удалось подготовить браузер.");
  }
});

document.getElementById("disconnect").addEventListener("click", async () => {
  await window.flowPostAgent.disconnect();
  applyState({ connected: false, account: null, status: "disconnected" });
  setStatus("Agent отключен.");
});

document
  .getElementById("deleteProfiles")
  .addEventListener("click", async () => {
    await window.flowPostAgent.deleteProfiles();
    setStatus("Локальные данные браузера удалены.");
  });

document.getElementById("openProfiles").addEventListener("click", async () => {
  await window.flowPostAgent.openProfiles();
});
