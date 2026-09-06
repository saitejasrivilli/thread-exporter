document.getElementById('export').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const formats = Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((c) => c.value);

  if (!formats.length) {
    statusEl.textContent = 'Pick at least one format.';
    return;
  }

  statusEl.textContent = 'Scrolling full thread, this can take a while...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('claude.ai')) {
    statusEl.textContent = 'Open a claude.ai chat tab first.';
    return;
  }

  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, func: scrapeFullChat },
    async (results) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        return;
      }
      const data = results && results[0] && results[0].result;
      if (!data || !data.messages || !data.messages.length) {
        statusEl.textContent = 'No messages found.';
        return;
      }

      statusEl.textContent = 'Generating file(s)...';
      const baseName = sanitize(data.title);
      const saved = [];

      for (const fmt of formats) {
        try {
          if (fmt === 'md') {
            await downloadBlob(new Blob([data.markdown], { type: 'text/markdown' }), baseName + '.md');
          } else if (fmt === 'docx') {
            const blob = await buildDocx(data.title, data.messages);
            await downloadBlob(blob, baseName + '.docx');
          } else if (fmt === 'pdf') {
            const blob = buildPdf(data.title, data.messages);
            await downloadBlob(blob, baseName + '.pdf');
          }
          saved.push(fmt);
        } catch (e) {
          statusEl.textContent = 'Error building ' + fmt + ': ' + e.message;
          return;
        }
      }

      statusEl.textContent = 'Saved: ' + saved.map((f) => baseName + '.' + f).join(', ');
    }
  );
});

function downloadBlob(blob, filename) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, () => resolve());
  });
}

function sanitize(name) {
  return (name || 'claude-chat').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 150);
}

async function buildDocx(title, messages) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
  ];
  messages.forEach((m) => {
    children.push(new Paragraph({ children: [new TextRun({ text: m.role + ':', bold: true })] }));
    m.text.split('\n').forEach((line) => {
      children.push(new Paragraph({ text: line }));
    });
    children.push(new Paragraph({ text: '' }));
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

function buildPdf(title, messages) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 50;

  function ensureSpace(lineHeight) {
    if (y + lineHeight > pageHeight - 40) {
      pdf.addPage();
      y = 50;
    }
  }

  pdf.setFontSize(16);
  pdf.text(title, marginX, y);
  y += 24;

  messages.forEach((m) => {
    pdf.setFontSize(11);
    pdf.setFont(undefined, 'bold');
    ensureSpace(16);
    pdf.text(m.role + ':', marginX, y);
    y += 16;

    pdf.setFont(undefined, 'normal');
    const wrapped = pdf.splitTextToSize(m.text, maxWidth);
    wrapped.forEach((line) => {
      ensureSpace(14);
      pdf.text(line, marginX, y);
      y += 14;
    });
    y += 10;
  });

  return pdf.output('blob');
}

// Injected into the page — runs in page context, no imports available.
// Combines scroll + expand + capture into ONE pass so text is grabbed while
// each portion is actually mounted (virtualized lists unmount off-screen
// content, so a single end-of-scroll snapshot misses everything scrolled past).
async function scrapeFullChat() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const expandPattern = /show more|read more|expand|see more|view more|ran \d+ command|viewed \d+ file|viewed a file|read a file|searched the web|and \d+ more tool/i;

  function getTitle() {
    const active = document.querySelector('[data-testid="chat-menu-item"][aria-current="page"], nav a[aria-current="page"]');
    if (active) {
      const t = active.textContent.trim();
      if (t) return t;
    }
    const docTitle = document.title.replace(/\s*[-|]\s*Claude.*$/i, '').trim();
    return docTitle || 'claude-chat';
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

  // Pass 1: scroll to the very top first (oldest messages), mounting from the start.
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

  // Pass 2: walk down in viewport-sized steps, capturing text at every stop.
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

  const step = Math.max(container.clientHeight * 0.6, 200);
  let stableRounds = 0;
  let pos = 0;
  for (let i = 0; i < 500; i++) {
    // expand any collapsed content in current viewport, capture, repeat until none left
    let expandGuard = 0;
    while (expandVisible(clickedSet) > 0 && expandGuard < 10) {
      await sleep(300);
      expandGuard++;
    }
    captureCurrentView();

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

  // Final capture at bottom to be safe.
  captureCurrentView();

  const title = getTitle();
  const fullText = orderedLines.join('\n');
  const messages = [{ role: 'Transcript', text: fullText }];
  const markdown = `# ${title}\n\n${fullText}`;

  return { title, markdown, messages };
}
