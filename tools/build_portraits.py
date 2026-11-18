"""Porträts historischer Generäle für die Truppen-Medaillons.

Liest den Abschnitt "portraits" aus tools/data/media.json, prüft die Lizenz jeder Datei an ihrer
Commons-Dateiseite (gleiche Prüfung wie tools/build_media.py), schneidet nur das Gesicht aus
(`crop` = Anteile x0, y0, x1, y1 des Bildes; ohne Mütze und Uniformabzeichen), tönt sepia und
schreibt public/media/portraits/<id>.webp (128 × 128) sowie den Abschnitt "portraits" in
public/media/credits.json und in MEDIA_SOURCES.md.

Aufruf: python tools/build_portraits.py   (Netz nötig, falls der Cache leer ist)
"""
from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

from PIL import Image, ImageOps

import build_media as bm

OUT = bm.OUT / 'portraits'
MARK_A = '<!-- portraits:start -->'
MARK_B = '<!-- portraits:end -->'


def main() -> None:
    cfg = json.loads((bm.ROOT / 'tools' / 'data' / 'media.json').read_text())
    items = cfg.get('portraits', [])
    bm.commons_prefetch([p['title'] for p in items])
    done = []
    for p in items:
        info = bm.commons_info(p['title'])
        if info['license'] not in bm.FREE_COMMONS or 'ungeklärt' in (info['description'] + info['credit']).lower():
            print('verworfen (Lizenz):', p['title'], info['license'])
            continue
        src = bm.commons_file(info, bm.CACHE / 'portraits' / f"{p['general']}{Path(urllib.parse.urlparse(info['url']).path).suffix.lower()}")
        im = Image.open(src).convert('RGB')
        if p.get('crop'):
            x0, y0, x1, y1 = p['crop']
            im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
        side = min(im.size)
        im = ImageOps.fit(im, (side, side), centering=(0.5, 0.4)).resize((128, 128), Image.LANCZOS)
        im = bm.sepia(im)
        OUT.mkdir(parents=True, exist_ok=True)
        size = bm.save_webp(im, OUT / f"{p['general']}.webp", 24 * 1024, 82)
        done.append({**info, 'id': p['general'], 'file': f"media/portraits/{p['general']}.webp", 'bytes': size,
                     'label': p['label'], 'changes': 'Ausschnitt Gesicht, 128 × 128, Sepia, WebP'})
        print(f"{p['general']:10} {size / 1024:5.1f} kB  {info['license']}")
    cred_path = bm.OUT / 'credits.json'
    credits = json.loads(cred_path.read_text())
    credits['portraits'] = [{k: d[k] for k in ('id', 'file', 'label', 'title', 'page', 'artist', 'date', 'license', 'licenseUrl', 'changes')} for d in done]
    cred_path.write_text(json.dumps(credits, ensure_ascii=False, indent=1))
    row = lambda *c: '| ' + ' | '.join(str(x).replace('|', '/').replace('\n', ' ') for x in c) + ' |'
    L = [MARK_A, '', '## Porträts der Generäle (Wikimedia Commons, Truppen-Medaillons)', '',
         'Erzeugt von `tools/build_portraits.py`. Nur das Gesicht wird gezeigt (ohne Mütze und Uniformabzeichen).', '',
         row('Datei', 'General', 'Quelle', 'Urheber', 'Datum', 'Lizenz', 'Bearbeitung'), row('---', '---', '---', '---', '---', '---', '---')]
    for d in done:
        L.append(row(f"`{d['file']}`", d['label'], f"[{d['title'][5:]}]({d['page']})", d['artist'] or 'unbekannt', d['date'][:30],
                     d['license'] + (f" ({d['licenseUrl']})" if d['licenseUrl'] else ''), d['changes']))
    L += ['', MARK_B]
    ms = bm.ROOT / 'MEDIA_SOURCES.md'
    text = ms.read_text()
    if MARK_A in text:
        text = text[:text.index(MARK_A)] + '\n'.join(L) + text[text.index(MARK_B) + len(MARK_B):]
    else:
        text = text.rstrip() + '\n\n' + '\n'.join(L) + '\n'
    ms.write_text(text)


if __name__ == '__main__':
    main()
