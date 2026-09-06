const statusEl = document.getElementById('status');

document.getElementById('export').addEventListener('click', async () => {
  const formats = Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((c) => c.value);

  if (!formats.length) {
    statusEl.textContent = 'Pick at least one format.';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:\/\//.test(tab.url)) {
    statusEl.textContent = 'Open a regular web page tab first.';
    return;
  }

  await chrome.runtime.sendMessage({ type: 'start-export', tabId: tab.id, formats });
  statusEl.textContent = 'Started — you can switch tabs or close this popup; you\'ll get a notification when done.';
});

// Live progress while the popup stays open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'progress-update' && msg.text) {
    statusEl.textContent = msg.text;
  }
});

// If a job is already running (popup was reopened), show its current state.
chrome.runtime.sendMessage({ type: 'get-progress' }, (progress) => {
  if (progress && progress.text) {
    statusEl.textContent = progress.text;
  }
});
