document.getElementById('export').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
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
  statusEl.textContent = 'Started — running in background. You can switch tabs or close this popup; you\'ll get a notification when it\'s done.';
});
