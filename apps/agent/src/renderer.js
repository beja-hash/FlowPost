const apiUrl = document.getElementById("apiUrl");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");
const statusNode = document.getElementById("status");
const profileRoot = document.getElementById("profileRoot");
const connectionStatus = document.getElementById("connectionStatus");
const account = document.getElementById("account");

function setStatus(message) {
  statusNode.textContent = message || "";
}

function applyState(state) {
  apiUrl.value = state.apiUrl || apiUrl.value;
  profileRoot.textContent = state.profileRoot || "";
  connectionStatus.textContent =
    state.status || (state.connected ? "connected" : "disconnected");
  account.textContent = state.account || "не подключен";
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
