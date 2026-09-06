let lastProgress = { phase: 'idle', text: '' };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'start-export') {
    runExport(msg.tabId, msg.formats).catch((e) => {
      setProgress('error', 'Failed: ' + String(e && e.message || e));
      notify('Export failed', String(e && e.message || e));
    });
    sendResponse({ started: true });
  } else if (msg && msg.type === 'scrape-progress') {
    setProgress('scraping', msg.text);
  } else if (msg && msg.type === 'get-progress') {
    sendResponse(lastProgress);
  }
  return true;
});

function setProgress(phase, text) {
  lastProgress = { phase, text };
  chrome.runtime.sendMessage({ type: 'progress-update', phase, text }).catch(() => {});
  const badge = phase === 'scraping' ? (text.match(/\d+%/) || [''])[0]
    : phase === 'building' ? '...'
    : phase === 'error' ? '!'
    : '';
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: phase === 'error' ? '#c0392b' : '#4b8bbe' });
}

async function runExport(tabId, formats) {
  setProgress('scraping', 'Starting scroll capture...');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeFullChat,
  });

  const data = results && results[0] && results[0].result;
  if (!data || !data.messages || !data.messages.length) {
    setProgress('idle', '');
    notify('Nothing found', 'No content could be captured from that page.');
    return;
  }

  setProgress('building', 'Generating file(s)...');
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    type: 'build-and-download',
    data,
    formats,
  });

  if (!response || !response.ok) {
    setProgress('error', 'Failed: ' + ((response && response.error) || 'Unknown error'));
    notify('Export failed', (response && response.error) || 'Unknown error');
    return;
  }

  const filenames = [];
  for (const file of response.files) {
    await new Promise((resolve) => {
      chrome.downloads.download({ url: file.dataUrl, filename: file.filename, saveAs: false }, () => resolve());
    });
    filenames.push(file.filename);
  }

  setProgress('idle', '');
  setProgress('done', 'Saved: ' + filenames.join(', '));
  notify('Export complete', 'Saved: ' + filenames.join(', '));
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Build docx/PDF files from captured page text and trigger downloads.',
  });
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message,
  });
}

// Injected into the target page — runs in page context, no imports available.
// Combines scroll + expand + capture into ONE pass so text is grabbed while
// each portion is actually mounted (virtualized lists unmount off-screen
// content, so a single end-of-scroll snapshot misses everything scrolled past).
async function scrapeFullChat() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const expandPattern = /show more|read more|expand|see more|view more|ran \d+ command|viewed \d+ file|viewed a file|read a file|searched the web|and \d+ more tool/i;

  function getTitle() {
    const active = document.querySelector(
      '[data-testid="chat-menu-item"][aria-current="page"], nav a[aria-current="page"], [aria-current="page"]'
    );
    if (active) {
      const t = active.textContent.trim();
      if (t) return t;
    }
    const docTitle = document.title.replace(/\s*[-|–]\s*[^-|–]*$/, '').trim();
    return docTitle || document.title.trim() || 'exported-page';
  }

  function findScrollContainer() {
    const candidates = document.querySelectorAll('main *');
    let best = null, bestScroll = 0;
    candidates.forEach((el) => {
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable > bestScroll && scrollable > 50) {
        bestScroll = scrollable;
        best = el;
      }
    });
    return best || document.scrollingElement || document.documentElement;
  }

  function expandVisible(clickedSet) {
    const clickable = Array.from(document.querySelectorAll('button, [role="button"], summary, [class*="cursor-pointer"]')).filter(
      (el) => expandPattern.test(el.textContent || '') && el.offsetParent !== null && !clickedSet.has(el)
    );
    clickable.forEach((b) => {
      clickedSet.add(b);
      try { b.click(); } catch (e) {}
    });
    return clickable.length;
  }

  const container = findScrollContainer();
  const clickedSet = new WeakSet();

  container.scrollTop = 0;
  await sleep(400);
  let guard = 0;
  let lastTop = -1;
  while (container.scrollTop !== lastTop && guard < 300) {
    lastTop = container.scrollTop;
    container.scrollTop = 0;
    await sleep(350);
    guard++;
  }

  const seenLines = new Set();
  const orderedLines = [];

  function captureCurrentView() {
    const text = container.innerText || '';
    text.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!seenLines.has(trimmed)) {
        seenLines.add(trimmed);
        orderedLines.push(trimmed);
      }
    });
  }

  function reportProgress(pct) {
    try {
      chrome.runtime.sendMessage({
        type: 'scrape-progress',
        text: `Scrolling & capturing... ${pct}% (${orderedLines.length} lines so far)`,
      });
    } catch (e) {}
  }

  const step = Math.max(container.clientHeight * 0.6, 200);
  let stableRounds = 0;
  let pos = 0;
  for (let i = 0; i < 500; i++) {
    let expandGuard = 0;
    while (expandVisible(clickedSet) > 0 && expandGuard < 10) {
      await sleep(300);
      expandGuard++;
    }
    captureCurrentView();

    const denom = Math.max(container.scrollHeight - container.clientHeight, 1);
    const pct = Math.min(99, Math.round((container.scrollTop / denom) * 100));
    reportProgress(pct);

    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
    if (atBottom) {
      stableRounds++;
      if (stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }

    pos += step;
    container.scrollTop = pos;
    await sleep(400);
  }

  captureCurrentView();
  reportProgress(100);

  const title = getTitle();
  const fullText = orderedLines.join('\n');
  const messages = [{ role: 'Transcript', text: fullText }];
  const markdown = `# ${title}\n\n${fullText}`;

  return { title, markdown, messages };
}
