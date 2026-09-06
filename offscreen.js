chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'build-and-download') {
    handleBuild(msg.data, msg.formats).then(sendResponse);
    return true; // async response
  }
});

async function handleBuild(data, formats) {
  try {
    const baseName = sanitize(data.title);
    const files = [];

    for (const fmt of formats) {
      let blob;
      if (fmt === 'md') {
        blob = new Blob([data.markdown], { type: 'text/markdown' });
      } else if (fmt === 'docx') {
        blob = await buildDocx(data.title, data.messages);
      } else if (fmt === 'pdf') {
        blob = buildPdf(data.title, data.messages);
      }
      if (!blob) continue;
      const dataUrl = await blobToDataUrl(blob);
      files.push({ dataUrl, filename: baseName + '.' + fmt });
    }

    // chrome.downloads isn't available in offscreen documents — hand the
    // built files back to the background service worker, which has full
    // extension API access, to actually trigger the downloads.
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sanitize(name) {
  return (name || 'exported-page').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 150);
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
