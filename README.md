# Thread Exporter

Chrome extension that exports an entire chat thread or long page — from
Claude.ai, ChatGPT, or any other site — including long, virtualized
conversations, to Markdown, Word (.docx), or PDF, named after the page title.

Runs in the background: switch tabs or close the popup right after clicking
Export, and it keeps working. You get a system notification when it's done.

## Why

Many chat UIs (Claude.ai, ChatGPT, etc.) virtualize long threads: only
messages near your current scroll position are actually in the DOM. A naive
"select all + copy" only grabs what's currently rendered. This extension
finds the page's main scrollable container and scrolls it from top to
bottom, capturing text at every step (and expanding any collapsed "show
more" / tool-call sections along the way) before compiling the full
transcript — works on any site, not just Claude.ai.

## Install (unpacked, for personal use)

1. Clone this repo:
   ```bash
   git clone https://github.com/<your-username>/thread-exporter.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `thread-exporter` folder

## Usage

1. Open any chat or long page (Claude.ai, ChatGPT, or any other site)
2. Click the extension icon in your Chrome toolbar
3. Check the format(s) you want: **Markdown**, **Word (.docx)**, **PDF**
4. Click **Export Thread**
5. That's it — you can immediately switch tabs, switch windows, or close the
   popup. The export keeps running in the background service worker.
6. A system notification appears when the file(s) finish downloading

## How it works

- Popup click sends a one-shot message to a persistent **background service
  worker** (`background.js`) and immediately hands off — the popup closing
  doesn't kill the job, unlike a plain popup-script approach
- Background worker injects a scrape function into the target tab via
  `chrome.scripting.executeScript` (works on any domain, doesn't require the
  tab to be focused/active):
  - Finds the page's largest scrollable container, scrolls it top to bottom
    in viewport-sized steps
  - At each step: clicks any visible "show more" / "read more" / collapsed
    tool-call ("Ran N commands...") elements to expand them, then captures
    `innerText`
  - Deduplicates lines across steps (virtualized re-renders repeat
    overlapping content) while preserving order
- Background worker hands the captured text to an **offscreen document**
  (`offscreen.html`/`offscreen.js`), the only context with DOM access outside
  of a visible page, to build the actual files:
  - **Markdown** — plain `.md` file
  - **.docx** — via a locally vendored build of [`docx`](https://www.npmjs.com/package/docx)
  - **PDF** — via a locally vendored build of [`jsPDF`](https://www.npmjs.com/package/jspdf)
- Offscreen document saves via `chrome.downloads.download`, then reports
  back; background worker fires a `chrome.notifications` alert

No data leaves your browser — everything runs locally against the page
that's already open and logged in. No server, no external API calls.

## Limitations

- Generic scroll/expand/capture heuristics work across sites but aren't
  perfect for every DOM structure — some pages may need selector tweaks.
- Very long threads take time to export since the whole conversation is
  scrolled through.
- Captures visible rendered text only (no images/attachments).
- If the source tab is closed before the scrape finishes, the job fails
  (the background worker still needs the tab to inject into).

## Project structure

```
thread-exporter/
├── manifest.json       # MV3 extension manifest (background + offscreen + host perms)
├── background.js       # Persistent service worker: orchestrates scrape + offscreen build
├── popup.html          # Toolbar popup UI (format checkboxes + export button)
├── popup.js            # Thin: reads checkboxes, kicks off background job, done
├── offscreen.html       # Hidden DOM-capable page for building docx/PDF
├── offscreen.js         # docx/PDF/Markdown generation + downloads
├── icon.png             # Notification icon
└── lib/
    ├── docx.min.js      # Vendored docx UMD build (Word export)
    └── jspdf.umd.min.js # Vendored jsPDF UMD build (PDF export)
```
