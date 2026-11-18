"""Medien für das Hauptmenü: Fotos, Zeitungs-Titelseiten, Musik.

Liest tools/data/media.json, prüft die Lizenz jeder Datei an ihrer Quelle, lädt sie (Cache in
tools/.cache/media), bearbeitet sie einheitlich und schreibt:
  public/media/photos/*.webp   Sepia, Filmkorn, Ausschnitt 16:9, 1600×900, WebP < 300 KB
  public/media/papers/*.webp   Titelseiten, leicht getönt, lesbar
  public/media/music/*.mp3     unter 5 MB
  public/media/credits.json    Bildnachweise für "Mitwirkende"
  MEDIA_SOURCES.md             Titel, Quelle, Urheber, Lizenz je Datei; verworfene Dateien

Aufruf: python tools/build_media.py   (Netz nötig, falls der Cache leer ist)
Wikimedia Commons: Originale werden für Skripte stark gedrosselt, daher Standard-Vorschaugrößen
(960/1280/1920 px) über thumb.wikimedia.org und Pausen zwischen den Anfragen.
"""
from __future__ import annotations

import html
import io
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / '.cache' / 'media'
OUT = ROOT / 'public' / 'media'
UA = 'MediaLicenseCheck/1.0 (non-commercial; low request rate)'
COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
DDB = 'https://api.deutsche-digitale-bibliothek.de'

# Lizenzen, die verwendet werden dürfen (Kurzname laut Commons bzw. URI)
FREE_COMMONS = {'Public domain', 'CC BY-SA 3.0 de', 'CC BY-SA 3.0', 'CC BY-SA 2.0', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC0'}
PDM = 'http://creativecommons.org/publicdomain/mark/1.0/'
PHOTO_MAX = 300 * 1024
MUSIC_MAX = 5 * 1024 * 1024


def http(url: str, accept: str = '*/*', tries: int = 4) -> bytes:
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
            return urllib.request.urlopen(req, timeout=180).read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == tries - 1:
                raise
            time.sleep(30)
    raise RuntimeError(url)


def strip(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', s or ''))).strip()


# ------------------------------------------------------------------ Commons
def meta_path(title: str) -> Path:
    return CACHE / 'meta' / (re.sub(r'[^A-Za-z0-9]+', '_', title)[:120] + '.json')


def commons_prefetch(titles: list[str]) -> None:
    """Lizenzangaben von der Dateiseite jeder Datei lesen (maschinenlesbare Lizenzfelder
    licensetpl_* und Informationsvorlage). Die API drosselt Skripte ohne Kontaktangabe."""
    for title in titles:
        if meta_path(title).exists():
            continue
        page = 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))
        h = http(page, 'text/html').decode('utf-8', 'replace')
        h = h.replace('&#95;', '_')  # manche Seiten maskieren Unterstriche in Klassennamen
        def field(fid):
            m = re.search(r'id="' + fid + r'"[^>]*>.*?</td>\s*<td[^>]*>(.*?)</td>', h, re.S)
            return strip(m.group(1)) if m else ''
        lic = re.search(r'class="licensetpl_short"[^>]*>(.*?)<', h, re.S)
        link = re.search(r'class="licensetpl_link"[^>]*>(.*?)<', h, re.S)
        full = re.search(r'class="fullMedia".*?href="(https://upload\.wikimedia\.org/[^"]+)"', h, re.S) \
            or re.search(r'href="(https://upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/[^"]+)"', h)
        dims = re.search(r'class="fullMedia".*?\(([\d.,]+)\s*×\s*([\d.,]+)', h, re.S)
        num = lambda x: int(re.sub(r'[^0-9]', '', x))
        info = {
            'title': title, 'page': page, 'url': html.unescape(full.group(1)).split('?')[0],
            'width': num(dims.group(1)) if dims else 0, 'height': num(dims.group(2)) if dims else 0,
            'license': strip(lic.group(1)) if lic else '', 'licenseUrl': strip(link.group(1)) if link else '',
            'usage': strip(lic.group(1)) if lic else '',
            'artist': field('fileinfotpl_aut') or field('fileinfotpl_perf'), 'credit': field('fileinfotpl_src'),
            'date': field('fileinfotpl_date'), 'description': field('fileinfotpl_desc')[:500], 'attribution': '',
        }
        if title.lower().endswith(('.ogg', '.mp3', '.flac', '.wav')):
            info['width'] = info['height'] = 0
        meta_path(title).parent.mkdir(parents=True, exist_ok=True)
        meta_path(title).write_text(json.dumps(info, ensure_ascii=False, indent=1))
        print('Lizenz', info['license'], '|', title)
        time.sleep(6)


def commons_info(title: str) -> dict:
    return json.loads(meta_path(title).read_text())


def commons_file(info: dict, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 10000:
        return dest
    url = info['url']
    if info['width'] > 0:  # Bild: Standard-Vorschaugröße
        w = 1920 if info['width'] >= 1920 else (1280 if info['width'] >= 1280 else 960)
        parts = urllib.parse.urlparse(url).path.split('/')
        url = 'https://thumb.wikimedia.org' + '/'.join(parts[:3]) + '/thumb/' + '/'.join(parts[3:]) + f'/{w}px-' + parts[-1]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(http(url))
    time.sleep(6)
    return dest


def check_commons(info: dict) -> None:
    if info['license'] not in FREE_COMMONS:
        raise SystemExit(f"Lizenz nicht freigegeben: {info['title']}: {info['license']!r}")


# ------------------------------------------------------------------ Zeitungen
def loc_page(lccn: str, date: str, dest: Path) -> dict:
    d = json.loads(http(f'https://www.loc.gov/resource/{lccn}/{date}/ed-1/?sp=1&fo=json'))
    jp2 = [x for x in d['page'] if x.get('mimetype') == 'image/jp2'][0]
    svc = jp2['info'].replace('/info.json', '')
    rights = strip(' '.join(d['item'].get('rights', [])))
    if 'public domain' not in rights.lower():
        raise SystemExit(f'Library of Congress: keine Gemeinfreiheits-Angabe für {lccn} {date}')
    if not (dest.exists() and dest.stat().st_size > 100000):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(http(f'{svc}/full/1600,/0/default.jpg'))
    return {'page': f'https://www.loc.gov/resource/{lccn}/{date}/ed-1/?sp=1', 'title': d['item']['title'],
            'rights': rights, 'author': 'Evening Star Newspaper Company (Washington, D.C.)',
            'provider': 'Library of Congress, Chronicling America'}


def ddb_page(item: str, dest: Path) -> dict:
    edm = http(f'{DDB}/2/items/{item}/edm', 'application/xml').decode('utf-8', 'replace')
    agg = re.search(r'<ore:Aggregation.*?</ore:Aggregation>', edm, re.S).group(0)
    rights = re.findall(r'rights rdf:resource="([^"]+)"', agg)
    if PDM not in rights:
        raise SystemExit(f'DDB {item}: keine Public Domain Mark ({rights})')
    by = re.search(r'isShownBy[^>]*rdf:resource="([^"]+)"', agg).group(1)
    title = re.search(r'<dc:title[^>]*>([^<]+)', edm).group(1)
    issued = re.search(r'<dcterms:issued[^>]*>([^<]+)', edm).group(1)
    if not (dest.exists() and dest.stat().st_size > 100000):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(http(by.replace('/full/!2000,2000/0/', '/full/1600,/0/')))
    return {'page': f'https://www.deutsche-digitale-bibliothek.de/newspaper/item/{item}', 'title': f'{title}, {issued}',
            'rights': 'Public Domain Mark 1.0 (Rechteangabe des Digitalisats im Deutschen Zeitungsportal)',
            'author': 'Verlag der Hallischen Nachrichten (Halle/Saale)',
            'provider': 'Universitäts- und Landesbibliothek Sachsen-Anhalt über das Deutsche Zeitungsportal'}


# ------------------------------------------------------------------ Bearbeitung
def sepia(im: Image.Image) -> Image.Image:
    g = ImageOps.autocontrast(im.convert('L'), cutoff=1)
    return ImageOps.colorize(g, black='#1b130b', mid='#86673f', white='#f1e2c2')


def grain(im: Image.Image, seed: int, strength: float) -> Image.Image:
    a = np.asarray(im).astype(np.float32)
    rng = np.random.default_rng(seed)
    n = rng.normal(0, strength, a.shape[:2])[..., None]
    return Image.fromarray(np.clip(a + n, 0, 255).astype(np.uint8))


def crop169(im: Image.Image, focus) -> Image.Image:
    w, h = im.size
    if w / h > 16 / 9:
        nw = round(h * 16 / 9)
        x = min(max(0, round(focus[0] * w - nw / 2)), w - nw)
        return im.crop((x, 0, x + nw, h))
    nh = round(w * 9 / 16)
    y = min(max(0, round(focus[1] * h - nh / 2)), h - nh)
    return im.crop((0, y, w, y + nh))


def save_webp(im: Image.Image, dest: Path, limit: int, q: int = 76) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    while True:
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= limit or q <= 30:
            dest.write_bytes(buf.getvalue())
            return buf.tell()
        q -= 4


def build_photo(p: dict, k: int) -> dict:
    info = commons_info(p['title'])
    check_commons(info)
    src = commons_file(info, CACHE / 'photos' / f"{p['id']}{Path(urllib.parse.urlparse(info['url']).path).suffix.lower()}")
    im = Image.open(src)
    im = crop169(im, p.get('focus', [0.5, 0.5])).resize((1600, 900), Image.LANCZOS)
    im = grain(sepia(im), 1939 + k, 9)
    size = save_webp(im, OUT / 'photos' / f"{p['id']}.webp", PHOTO_MAX)
    return {**info, 'id': p['id'], 'file': f"media/photos/{p['id']}.webp", 'bytes': size, 'motiv': p['motiv'],
            'changes': 'Ausschnitt 16:9, auf 1600×900 skaliert, Sepia, Filmkorn, WebP'}


def build_paper(p: dict) -> dict:
    raw = CACHE / 'papers' / f"{p['id']}.jpg"
    meta = loc_page(p['lccn'], p['date'], raw) if p['source'] == 'loc' else ddb_page(p['item'], raw)
    im = Image.open(raw).convert('L')
    if p.get('cropBottom'):
        im = im.crop((0, 0, im.width, round(im.height * (1 - p['cropBottom']))))
    im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    im = ImageOps.colorize(ImageOps.autocontrast(im, cutoff=0.5), black='#20190f', white='#efe4cb')
    size = save_webp(im, OUT / 'papers' / f"{p['id']}.webp", 420 * 1024, 80)
    return {**meta, 'id': p['id'], 'label': p['label'], 'file': f"media/papers/{p['id']}.webp", 'bytes': size,
            'changes': 'verkleinert auf 1200 px Breite, getönt' + (', Bibliotheksleiste unten abgeschnitten' if p.get('cropBottom') else '')}


def build_music(m: dict) -> dict:
    info = commons_info(m['title'])
    check_commons(info)
    src = commons_file(info, CACHE / 'music' / f"{m['id']}.ogg")
    dest = OUT / 'music' / f"{m['id']}.mp3"
    dest.parent.mkdir(parents=True, exist_ok=True)
    br = m.get('bitrate', '80k')
    while True:
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(src)]
        if m.get('start'):
            cmd += ['-ss', str(m['start'])]
        if m.get('duration'):
            cmd += ['-t', str(m['duration']), '-af', f"afade=t=out:st={m['duration'] - 6}:d=6"]
        cmd += ['-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', br, '-map_metadata', '-1', str(dest)]
        subprocess.run(cmd, check=True)
        if dest.stat().st_size <= MUSIC_MAX or br == '48k':
            break
        br = {'80k': '64k', '64k': '56k', '56k': '48k'}[br]
    return {**info, 'id': m['id'], 'label': m['label'], 'file': f"media/music/{m['id']}.mp3", 'bytes': dest.stat().st_size,
            'changes': f"MP3 {br}" + (f", auf {m['duration'] // 60} Minuten gekürzt (Trauermarsch ohne Finale)" if m.get('duration') else '')}


# ------------------------------------------------------------------ Nachweise
def write_sources(photos, papers, music, rejected) -> None:
    def row(*c):
        return '| ' + ' | '.join(str(x).replace('|', '/').replace('\n', ' ') for x in c) + ' |'
    L = ['# Medien im Hauptmenü – Quellen und Lizenzen', '',
         'Erzeugt von `tools/build_media.py` aus `tools/data/media.json`. Die Lizenz jeder Datei wurde beim Bau',
         'an ihrer Quelle gelesen (Commons: Lizenzangabe der Dateiseite; Library of Congress: Rechteangabe des',
         'Exemplars; Deutsches Zeitungsportal: Rechteangabe des Digitalisats). Alle Bilder sind bearbeitet',
         '(siehe Spalte „Bearbeitung“). Bundesarchiv-Fotos: CC BY-SA 3.0 DE – die bearbeiteten Fassungen',
         'stehen unter derselben Lizenz.', '',
         '## Fotos (Wikimedia Commons)', '',
         row('Datei', 'Titel', 'Urheber', 'Datum', 'Lizenz', 'Bearbeitung'), row('---', '---', '---', '---', '---', '---')]
    for p in photos:
        L.append(row(f"`{p['file']}`", f"[{p['title'][5:]}]({p['page']})", p['artist'] or 'unbekannt', p['date'][:30],
                     f"{p['license']}" + (f" ({p['licenseUrl']})" if p['licenseUrl'] else ''), p['changes']))
    L += ['', '## Zeitungs-Titelseiten', '', row('Datei', 'Ausgabe', 'Herausgeber', 'Bereitgestellt von', 'Rechteangabe', 'Bearbeitung'),
          row('---', '---', '---', '---', '---', '---')]
    for p in papers:
        L.append(row(f"`{p['file']}`", f"[{p['label']}]({p['page']})", p['author'], p['provider'], p['rights'][:400], p['changes']))
    L += ['', 'Hinweis Library of Congress: Laut Rechteangabe gelten die Zeitungen in Chronicling America als gemeinfrei',
          'oder ohne bekannte Rechte; Ausgaben jünger als 95 Jahre können Material Dritter enthalten (z. B. Agenturfotos,',
          'Karikaturen). Die Seiten werden als Ganzes, verkleinert und als historisches Dokument gezeigt.', '',
          '## Musik (Wikimedia Commons)', '', row('Datei', 'Werk', 'Aufnahme/Urheber', 'Lizenz', 'Bearbeitung'), row('---', '---', '---', '---', '---')]
    for m in music:
        L.append(row(f"`{m['file']}`", f"[{m['label']}]({m['page']})", m['artist'], f"{m['license']} – {m['usage']}", m['changes']))
    if not music:
        L += ['Noch keine Musik eingebunden: Wikimedia Commons verweigert Skripten ohne Kontaktangabe den Download der',
              'Originaldateien (HTTP 429). Vorgesehen sind Holst „Mars“ (US Air Force Band) und Wagner „Siegfrieds',
              'Trauermarsch“ (US Marine Band), beide auf Commons als gemeinfrei gekennzeichnet; siehe `tools/data/media.json`.']
    L += ['', '## Verworfen', '', row('Datei / Quelle', 'Grund'), row('---', '---')]
    for r in rejected:
        L.append(row(r['title'], r['reason']))
    (ROOT / 'MEDIA_SOURCES.md').write_text('\n'.join(L) + '\n')


def main() -> None:
    cfg = json.loads((ROOT / 'tools' / 'data' / 'media.json').read_text())
    commons_prefetch([p['title'] for p in cfg['photos']] + [m['title'] for m in cfg['music']])
    # Unklare Rechte trotz Lizenzvorlage (z. B. Originalstempel "Rechte ungeklärt") -> weglassen
    usable = []
    for p in cfg['photos']:
        info = commons_info(p['title'])
        if 'ungeklärt' in (info['description'] + info['credit']).lower():
            cfg['rejected'].insert(0, {'title': p['title'], 'reason': f"Lizenzvorlage {info['license']}, aber die Dateiseite vermerkt einen Originalstempel „Rechte ungeklärt“ – unklar, verworfen."})
            continue
        if info['license'] not in FREE_COMMONS:
            cfg['rejected'].insert(0, {'title': p['title'], 'reason': f"Lizenz {info['license']!r} nicht eindeutig frei – verworfen."})
            continue
        usable.append(p)
    print(f'{len(usable)} Fotos verwendbar')
    photos = [build_photo(p, k) for k, p in enumerate(usable)]
    papers = [build_paper(p) for p in cfg['papers']]
    music = []
    for m in cfg['music']:
        try:
            music.append(build_music(m))
        except urllib.error.HTTPError as e:  # Wikimedia drosselt Originale; Menü funktioniert auch ohne Musik
            print(f"Musik nicht geladen ({e.code}): {m['title']}")
    credits = {
        'photos': [{k: p[k] for k in ('id', 'file', 'title', 'page', 'artist', 'date', 'license', 'licenseUrl', 'motiv', 'changes')} for p in photos],
        'papers': [{k: p[k] for k in ('id', 'file', 'label', 'page', 'author', 'provider', 'rights', 'changes')} for p in papers],
        'music': [{k: m[k] for k in ('id', 'file', 'label', 'page', 'artist', 'license', 'changes')} for m in music],
    }
    for c in credits['papers']:
        c['rights'] = 'Public Domain Mark 1.0' if 'Public Domain Mark' in c['rights'] else 'gemeinfrei bzw. ohne bekannte Rechte (Library of Congress)'
    (OUT / 'credits.json').write_text(json.dumps(credits, ensure_ascii=False, indent=1))
    write_sources(photos, papers, music, cfg['rejected'])
    for x in photos + papers + music:
        print(f"{x['file']:32} {x['bytes'] / 1024:7.0f} kB")


if __name__ == '__main__':
    main()
