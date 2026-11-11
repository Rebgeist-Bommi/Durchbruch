"""Schritt 1: Rohdaten herunterladen nach tools/.cache.

Aufruf:  python tools/fetch_data.py
Idempotent: bereits vorhandene Dateien werden nicht erneut geladen.
"""
import hashlib
import lzma
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import CACHE, SOURCES  # noqa: E402


def download(url: str, dest: Path) -> bool:
    try:
        print(f"  lade {url}")
        with urllib.request.urlopen(url, timeout=120) as r, open(dest.with_suffix(".part"), "wb") as f:
            shutil.copyfileobj(r, f)
        dest.with_suffix(".part").rename(dest)
        return True
    except Exception as exc:  # Netzwerkrichtlinie, 403, Timeout …
        print(f"  fehlgeschlagen: {exc}")
        dest.with_suffix(".part").unlink(missing_ok=True)
        return False


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def topography_from_git(dest: Path, src: dict) -> None:
    """Baut die NetCDF-Datei aus den Rohdaten des fatiando-Repositorys nach
    (gleiches Verfahren wie dessen prepare.ipynb: ICGEM-ASCII -> NetCDF)."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        subprocess.run(["git", "clone", "-q", "--depth", "1", src["git"], str(repo)], check=True,
                       env={"GIT_LFS_SKIP_SMUDGE": "1", **__import__("os").environ})
        raw = repo / src["git_raw"]
        with lzma.open(raw, "rt") as f:
            for line in f:
                if line.startswith("end_of_head"):
                    break
            table = pd.read_csv(f, sep=r"\s+", header=None, names=["lon", "lat", "z"],
                                dtype=np.float64)
    lon = np.linspace(-180, 180, 2161)
    lat = np.linspace(-90, 90, 1081)
    # Datei ist zeilenweise von Nord nach Süd, innerhalb der Zeile West nach Ost geordnet
    z = table["z"].to_numpy().reshape(1081, 2161)[::-1, :]
    ds = xr.Dataset(
        {"topography": (("latitude", "longitude"), z.astype("float32"),
                        {"long_name": "topographic height above mean sea level", "units": "m"})},
        coords={"longitude": lon, "latitude": lat},
        attrs={"source": "ETOPO1 ice surface via ICGEM, rebuilt from fatiando-data raw/etopo1.gdf.xz",
               "license": "CC-BY-4.0 (fatiando-data), original public domain (NOAA)"},
    )
    ds.to_netcdf(dest, encoding={"topography": {"zlib": True, "complevel": 5}})


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for key, src in SOURCES.items():
        dest = CACHE / src["file"]
        if dest.exists():
            print(f"[{key}] vorhanden")
            continue
        print(f"[{key}]")
        ok = download(src["url"], dest)
        if ok and "sha256" in src and sha256(dest) != src["sha256"]:
            print("  Prüfsumme falsch, verwerfe Datei")
            dest.unlink()
            ok = False
        if not ok and key == "topography":
            print("  Ersatzweg: Rohdaten aus Git-Repository")
            topography_from_git(dest, src)
            ok = True
        if not ok:
            sys.exit(f"Quelle {key} nicht erreichbar")
    # CShapes entpacken
    xz = CACHE / SOURCES["cshapes"]["file"]
    js = xz.with_suffix("")
    if not js.exists():
        with lzma.open(xz) as fi, open(js, "wb") as fo:
            shutil.copyfileobj(fi, fo)
    print("fertig")


if __name__ == "__main__":
    main()
