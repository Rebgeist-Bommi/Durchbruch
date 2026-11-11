"""Höhenmodell (ETOPO1, 10 Bogenminuten) laden und bilinear abtasten."""
import sys
from pathlib import Path

import numpy as np
import xarray as xr
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import CACHE, CRS, SOURCES  # noqa: E402

_TO_LONLAT = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


def load_interpolator() -> RegularGridInterpolator:
    ds = xr.load_dataset(CACHE / SOURCES["topography"]["file"])
    t = ds["topography"].sel(longitude=slice(-40, 70), latitude=slice(20, 85))
    return RegularGridInterpolator((t.latitude.values, t.longitude.values), t.values.astype("float64"),
                                   bounds_error=False, fill_value=-1000.0)


def sample_xy(interp, x, y):
    """Höhe in Metern an Projektionskoordinaten (EPSG:3035)."""
    lon, lat = _TO_LONLAT.transform(np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64"))
    return interp(np.stack([lat, lon], axis=-1))
