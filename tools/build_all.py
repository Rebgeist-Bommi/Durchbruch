"""Gesamte Datenpipeline von Phase 1 reproduzierbar ausführen.

    pip install -r tools/requirements.txt
    python tools/build_all.py          # lädt Rohdaten, baut public/data/*, startet Tests
"""
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
STEPS = ["fetch_data.py", "territories.py", "build_grid.py", "build_relief.py", "build_vectors.py", "build_infra.py"]


def main() -> None:
    for step in STEPS:
        print(f"== {step}")
        subprocess.run([sys.executable, str(TOOLS / step)], check=True)
    print("== Tests")
    subprocess.run([sys.executable, "-m", "pytest", "-q", str(TOOLS / "tests")], check=True)


if __name__ == "__main__":
    main()
