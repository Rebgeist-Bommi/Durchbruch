"""Phase 3: Infrastruktur, Industriezentren, Rohstoffgebiete."""
import json

import numpy as np

from config import COLS, OUT, ROWS


def load():
    infra = json.loads((OUT / "infra.json").read_text(encoding="utf-8"))
    meta = json.loads((OUT / "grid.json").read_text(encoding="utf-8"))
    terr = np.frombuffer((OUT / "grid.bin").read_bytes(), dtype=np.uint8)[: ROWS * COLS]
    owner = {t["id"]: t["owner"] for t in meta["territories"]}
    return infra, terr, owner


def test_rail_network():
    infra, terr, _ = load()
    cells = np.cumsum(infra["rail"])
    assert len(cells) > 8000
    assert np.all(np.diff(cells) > 0)
    assert np.all(terr[cells] > 0), "Bahnfelder liegen auf Land"
    assert len(infra["nodes"]) > 200
    names = {n["n"] for n in infra["nodes"]}
    assert {"Berlin", "Warschau", "Posen"} <= names


def test_bridges_over_major_rivers():
    infra, _, _ = load()
    names = [b["name"] for b in infra["bridges"]]
    assert any(n.startswith("Weichselbrücke") for n in names)
    assert any(n.startswith("Rheinbrücke") for n in names)
    assert any(n.startswith("Oderbrücke") for n in names)


def test_industry_sites_belong_to_their_nation():
    infra, terr, owner = load()
    required = {"Ruhrgebiet", "Oberschlesien", "Sachsen", "Berlin", "Hamburg", "Pilsen", "Salzgitter",
                "Leuna", "Ludwigshafen", "Linz", "Stalowa Wola", "Lothringen", "Le Creusot"}
    names = {s["name"] for s in infra["industry"]}
    assert required <= names
    for s in infra["industry"]:
        assert owner[int(terr[s["c"]])] == s["nation"], s["name"]


def test_resource_regions():
    infra, terr, owner = load()
    kinds = {r["kind"] for r in infra["resources"]}
    assert kinds == {"Kohle", "Erz", "Öl"}
    for r in infra["resources"]:
        assert r["cells"], r["name"]
    ruhr = next(r for r in infra["resources"] if r["name"] == "Ruhr")
    assert all(owner[int(terr[c])] == "DEU" for c in ruhr["cells"])
