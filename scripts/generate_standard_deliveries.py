"""Refresh the frontend's offline replay data from the backend physics simulator."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from services.sample_generator import DeliveryPhysicsSimulator


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the committed output without writing it.")
    args = parser.parse_args()
    deliveries = {
        preset["id"]: DeliveryPhysicsSimulator.generate_delivery(preset["id"])
        for preset in DeliveryPhysicsSimulator.get_all_preset_deliveries()
    }
    output = ROOT / "frontend" / "src" / "utils" / "standardDeliveries.json"
    if args.check:
        if not output.is_file() or json.loads(output.read_text(encoding="utf-8")) != deliveries:
            raise SystemExit("Bundled deliveries are stale. Run python scripts/generate_standard_deliveries.py.")
        print(f"Verified {len(deliveries)} bundled deliveries.")
    else:
        output.write_text(json.dumps(deliveries, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
