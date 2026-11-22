#!/usr/bin/env python3
"""Turn chosen PDF pages into watermarked sample images for a part's page.

Usage:
  python3 scripts/make-samples.py <part number> <pdf file> <page> [<page> ...]
  python3 scripts/make-samples.py 1 private/books/book1.pdf 3 5 12 40 41 87

Writes public/samples/part<N>/01.webp, 02.webp, ... (old images in that folder are removed)
and updates the part's "samples" list in data/catalog.json.
Needs: poppler's pdftoppm, and Pillow built with libraqm (for Arabic text).
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont, features

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONT = os.path.join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf')
WIDTH = 900  # px; enough to read a page full-screen on a phone or laptop
YELLOW, BLACK = (255, 210, 0), (0, 0, 0)


def watermark(page: Image.Image) -> Image.Image:
    page = page.convert('RGB')
    w, h = page.size
    rtl = {'direction': 'rtl', 'language': 'ar'} if features.check('raqm') else {}

    # Large faint diagonal "عينة" across the middle.
    layer = Image.new('RGBA', (w * 2, h * 2), (0, 0, 0, 0))
    big = ImageFont.truetype(FONT, int(w * 0.32))
    d = ImageDraw.Draw(layer)
    d.text((w, h), 'عينة', font=big, fill=(0, 0, 0, 34), anchor='mm', **rtl)
    layer = layer.rotate(30, resample=Image.BICUBIC).crop((w // 2, h // 2, w // 2 + w, h // 2 + h))
    page = Image.alpha_composite(page.convert('RGBA'), layer)

    # Yellow corner badge, like the covers' part-number block.
    small = ImageFont.truetype(FONT, int(w * 0.045))
    d = ImageDraw.Draw(page)
    pad = int(w * 0.02)
    box = d.textbbox((0, 0), 'عينة', font=small, **rtl)
    bw, bh = box[2] - box[0] + pad * 3, box[3] - box[1] + pad * 2
    x0, y0 = int(w * 0.03), int(w * 0.03)
    d.rectangle((x0, y0, x0 + bw, y0 + bh), fill=YELLOW)
    d.rectangle((x0, y0 + bh, x0 + bw, y0 + bh + max(3, pad // 2)), fill=BLACK)
    d.text((x0 + bw / 2, y0 + bh / 2), 'عينة', font=small, fill=BLACK, anchor='mm', **rtl)
    return page.convert('RGB')


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    part, pdf, pages = int(sys.argv[1]), sys.argv[2], [int(p) for p in sys.argv[3:]]
    out_dir = os.path.join(ROOT, 'public', 'samples', f'part{part}')
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith('.webp'):
            os.remove(os.path.join(out_dir, f))

    urls = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, p in enumerate(pages, 1):
            base = os.path.join(tmp, f'p{i}')
            subprocess.run(['pdftoppm', '-png', '-r', '150', '-f', str(p), '-l', str(p), '-singlefile', pdf, base], check=True)
            img = Image.open(base + '.png')
            img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
            name = f'{i:02d}.webp'
            watermark(img).save(os.path.join(out_dir, name), 'WEBP', quality=80, method=6)
            urls.append(f'/samples/part{part}/{name}')
            print(f'page {p} -> {name}')

    cat_path = os.path.join(ROOT, 'data', 'catalog.json')
    with open(cat_path, encoding='utf-8') as fh:
        cat = json.load(fh)
    cat['books'][part - 1]['samples'] = urls
    with open(cat_path, 'w', encoding='utf-8') as fh:
        json.dump(cat, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'catalog updated: part {part} has {len(urls)} sample pages')


if __name__ == '__main__':
    main()
