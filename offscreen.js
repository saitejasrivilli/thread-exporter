chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'build-and-download') {
    handleBuild(msg.data, msg.formats).then(sendResponse);
    return true; // async response
  }
});

async function handleBuild(data, formats) {
  try {
    const baseName = sanitize(data.title);
    const filenames = [];

    for (const fmt of formats) {
      if (fmt === 'md') {
        await downloadBlob(new Blob([data.markdown], { type: 'text/markdown' }), baseName + '.md');
      } else if (fmt === 'docx') {
        const blob = await buildDocx(data.title, data.messages);
        await downloadBlob(blob, baseName + '.docx');
      } else if (fmt === 'pdf') {
        const blob = buildPdf(data.title, data.messages);
        await downloadBlob(blob, baseName + '.pdf');
      }
      filenames.push(baseName + '.' + fmt);
    }

    return { ok: true, filenames };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function downloadBlob(blob, filename) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, () => resolve());
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
