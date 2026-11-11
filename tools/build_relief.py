"""Schritt 4: facettiertes Gebirgsrelief (Delaunay-Dreiecke) erzeugen.

Verfahren:
  1. Unregelmäßige Stützpunkte: gejittertes Gitter (14 km), in Hochlagen verdichtet (7 km).
     Zufall mit festem Startwert -> reproduzierbar.
  2. Höhe je Punkt aus dem Höhenmodell (bilinear).
  3. Delaunay-Triangulation, nur Dreiecke im Bergland behalten.
  4. Flacher Schattenton je Dreieck: Lambert-Beleuchtung aus Nordwest, in 5 Stufen
     quantisiert, dazu 3 Höhenstufen für die Deckkraft.

Ausgabe public/data/relief.bin (little endian):
  uint32 nVerts, uint32 nTris, int32 originX, int32 originY, uint32 unit (Meter)
  nVerts × (uint16 x, uint16 y)  – Weltkoordinate = origin + wert × unit
  nTris × 3 × uint32              – Eckindizes
  nTris × uint8                   – Ton = Schattenstufe (0–4) + 5 × Höhenstufe (0–2)
"""
import struct
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import Delaunay

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import OUT, X_MAX, X_MIN, Y_MAX, Y_MIN  # noqa: E402
from dem import load_interpolator, sample_xy  # noqa: E402

UNIT = 250
ORIGIN_X = X_MIN - 50_000
ORIGIN_Y = Y_MIN - 50_000
SEED = 1939
BASE = 14_000
DENSE = 7_000
EXAGGERATION = 18.0
SHADES = 5
LIGHT_AZIMUTH = np.radians(315.0)   # Nordwest
LIGHT_ALTITUDE = np.radians(40.0)
MIN_TRI_ELEV = 500.0    # höchster Eckpunkt muss mindestens so hoch liegen
BANDS = (700.0, 1300.0)  # Grenzen der Höhenstufen


def jittered(spacing: float, rng: np.random.Generator) -> np.ndarray:
    xs = np.arange(X_MIN - spacing, X_MAX + spacing, spacing)
    ys = np.arange(Y_MIN - spacing, Y_MAX + spacing, spacing)
    X, Y = np.meshgrid(xs, ys)
    pts = np.stack([X.ravel(), Y.ravel()], axis=1)
    return pts + rng.uniform(-0.42, 0.42, pts.shape) * spacing


def main() -> None:
    rng = np.random.default_rng(SEED)
    interp = load_interpolator()

    base = jittered(BASE, rng)
    zb = sample_xy(interp, base[:, 0], base[:, 1])
    dense = jittered(DENSE, rng)
    zd = sample_xy(interp, dense[:, 0], dense[:, 1])
    keep_dense = zd > 1100
    pts = np.concatenate([base[zb > -50], dense[keep_dense]])
    z = np.concatenate([zb[zb > -50], zd[keep_dense]])
    inside = ((pts[:, 0] > X_MIN - 40_000) & (pts[:, 0] < X_MAX + 40_000)
              & (pts[:, 1] > Y_MIN - 40_000) & (pts[:, 1] < Y_MAX + 40_000))
    pts, z = pts[inside], z[inside]

    tri = Delaunay(pts)
    simp = tri.simplices
    zt = z[simp]
    good = (zt.max(axis=1) >= MIN_TRI_ELEV) & (zt.min(axis=1) > 0)
    simp = simp[good]

    # Flächennormalen
    p = np.concatenate([pts, (z * EXAGGERATION)[:, None]], axis=1)
    a, b, c = p[simp[:, 0]], p[simp[:, 1]], p[simp[:, 2]]
    n = np.cross(b - a, c - a)
    n[n[:, 2] < 0] *= -1
    n /= np.linalg.norm(n, axis=1)[:, None]
    light = np.array([np.cos(LIGHT_ALTITUDE) * np.sin(LIGHT_AZIMUTH),
                      np.cos(LIGHT_ALTITUDE) * np.cos(LIGHT_AZIMUTH),
                      np.sin(LIGHT_ALTITUDE)])
    lam = np.clip(n @ light, 0, 1)
    # relativ zur Beleuchtung einer ebenen Fläche: < 1 Schatten, > 1 Licht
    rel = lam / np.sin(LIGHT_ALTITUDE)
    edges = np.array([0.62, 0.86, 1.06, 1.22])
    shade = np.digitize(rel, edges).astype(np.uint8)          # 0 (dunkel) … 4 (hell)
    print("Perzentile rel:", np.round(np.percentile(rel, [5, 15, 30, 50, 70, 85, 95]), 2))
    zmean = z[simp].mean(axis=1)
    band = np.digitize(zmean, BANDS).astype(np.uint8)         # 0 … 2
    tone = shade + SHADES * band

    used = np.unique(simp)
    remap = np.full(len(pts), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    verts = pts[used]
    vx = np.clip(np.round((verts[:, 0] - ORIGIN_X) / UNIT), 0, 65535).astype("<u2")
    vy = np.clip(np.round((verts[:, 1] - ORIGIN_Y) / UNIT), 0, 65535).astype("<u2")
    idx = remap[simp].astype("<u4")

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "relief.bin", "wb") as f:
        f.write(struct.pack("<IIiiI", len(verts), len(idx), ORIGIN_X, ORIGIN_Y, UNIT))
        f.write(np.stack([vx, vy], axis=1).tobytes())
        f.write(idx.tobytes())
        f.write(tone.astype(np.uint8).tobytes())
    print(f"Relief: {len(verts)} Punkte, {len(idx)} Dreiecke, Schattenstufen {np.bincount(shade, minlength=5)}")


if __name__ == "__main__":
    main()
