// Personalizes each downloaded PDF: a small footer on every page naming the buyer,
// plus the order number in the document's metadata. The original file is never modified.
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// DejaVu Sans covers Latin and Arabic in one font; fontkit joins Arabic letters
// and lays an Arabic run out right-to-left.
const FONT_BYTES = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf'));

// Keep at most N stamping jobs in memory at once (the free server has ~512MB RAM).
const MAX_PARALLEL = parseInt(process.env.STAMP_CONCURRENCY || '2', 10);
let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

// Strip control and bidi-override characters so a name can't scramble the footer.
const clean = (s, max) =>
  String(s || '').replace(/[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @param {Buffer} srcBytes original PDF
 * @param {{name?: string, email: string, orderId: string, date?: Date}} buyer
 * @returns {Promise<Uint8Array>}
 */
async function stampPdf(srcBytes, buyer) {
  return withSlot(async () => {
    const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(FONT_BYTES, { subset: true });

    const name = clean(buyer.name, 60);
    const email = clean(buyer.email, 120);
    const date = (buyer.date || new Date()).toISOString().slice(0, 10);

    // Drawn as separate runs so an Arabic name keeps its own right-to-left order.
    const size = 7;
    const runs = ['Licensed to ', name, `${name ? '  ·  ' : ''}${email}  ·  Order ${buyer.orderId}  ·  ${date}`]
      .filter(Boolean)
      .map((text) => ({ text, width: font.widthOfTextAtSize(text, size) }));
    const total = runs.reduce((s, r) => s + r.width, 0);
    const color = rgb(0.45, 0.45, 0.45);

    for (const page of doc.getPages()) {
      const box = page.getCropBox();
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      // Start point so the footer sits centred on the *visual* bottom edge for any page rotation.
      let x;
      let y;
      if (angle === 90) { x = box.x + box.width - 10; y = box.y + (box.height - total) / 2; }
      else if (angle === 180) { x = box.x + (box.width + total) / 2; y = box.y + box.height - 10; }
      else if (angle === 270) { x = box.x + 10; y = box.y + (box.height + total) / 2; }
      else { x = box.x + (box.width - total) / 2; y = box.y + 10; }

      const rad = (angle * Math.PI) / 180;
      let offset = 0;
      for (const r of runs) {
        page.drawText(r.text, {
          x: x + offset * Math.cos(rad), y: y + offset * Math.sin(rad),
          size, font, color, rotate: degrees(angle),
        });
        offset += r.width;
      }
    }

    doc.setSubject(`Licensed to ${email} - order ${buyer.orderId}`);
    doc.setKeywords([buyer.orderId, email]);
    return doc.save();
  });
}

module.exports = { stampPdf };
