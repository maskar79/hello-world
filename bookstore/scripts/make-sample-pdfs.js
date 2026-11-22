// Creates placeholder PDFs in private/books/ so the store can be tested before
// the real books are added. Existing files are never overwritten.
const fs = require('fs');
const path = require('path');

const dir = process.env.BOOKS_DIR || path.join(__dirname, '..', 'private', 'books');
fs.mkdirSync(dir, { recursive: true });

function minimalPdf(text) {
  const stream = `BT /F1 28 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { out += `${String(off).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

const catalog = require('../data/catalog.json');
for (const b of catalog.books) {
  const f = path.join(dir, b.file);
  if (fs.existsSync(f)) { console.log(`exists, skipped: ${b.file}`); continue; }
  fs.writeFileSync(f, minimalPdf(`Sample placeholder for ${b.id}`));
  console.log(`created: ${b.file}`);
}
