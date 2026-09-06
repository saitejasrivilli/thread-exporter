# Universal Chat Exporter

Chrome extension that exports an entire chat thread or long page — from
Claude.ai, ChatGPT, or any other site — including long, virtualized
conversations, to Markdown, Word (.docx), or PDF, named after the page title.

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
   git clone https://github.com/<your-username>/claude-thread-exporter.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `claude-thread-exporter` folder

## Usage

1. Open any chat or long page (Claude.ai, ChatGPT, or any other site)
2. Click the extension icon in your Chrome toolbar
3. Check the format(s) you want: **Markdown**, **Word (.docx)**, **PDF**
4. Click **Export Thread**
5. Wait — the extension scrolls the whole conversation (top to bottom) to
   force every message to load; this can take a while on long threads. Don't
   close the popup while it's running.
6. File(s) download automatically, named after the chat title

## How it works

- `chrome.scripting.executeScript` injects a function into the active tab
  (no server, no external API calls, works on any domain)
- Finds the page's largest scrollable container, scrolls it from top to
  bottom in viewport-sized steps
- At each step: clicks any visible "show more" / "read more" / collapsed
  tool-call ("Ran N commands...") elements to expand them, then captures
  `innerText`
- Deduplicates lines across steps (virtualized re-renders repeat overlapping
  content) while preserving order
- Builds the final document:
  - **Markdown** — plain `.md` file
  - **.docx** — via a locally vendored build of [`docx`](https://www.npmjs.com/package/docx)
  - **PDF** — via a locally vendored build of [`jsPDF`](https://www.npmjs.com/package/jspdf)
- Saves via `chrome.downloads.download`

No data leaves your browser — everything runs locally against the page
that's already open and logged in.

## Limitations

- Generic scroll/expand/capture heuristics work across sites but aren't
  perfect for every DOM structure — some pages may need selector tweaks.
- Very long threads take time to export since the whole conversation is
  scrolled through.
- Captures visible rendered text only (no images/attachments).

## Project structure

```
claude-thread-exporter/
├── manifest.json      # MV3 extension manifest
├── popup.html          # Toolbar popup UI (format checkboxes + export button)
├── popup.js            # Scrape logic + docx/PDF/Markdown generation
└── lib/
    ├── docx.min.js     # Vendored docx UMD build (Word export)
    └── jspdf.umd.min.js # Vendored jsPDF UMD build (PDF export)
```
