"""Refresh the frontend's offline replay data from the backend physics simulator."""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from services.sample_generator import DeliveryPhysicsSimulator


if __name__ == "__main__":
    deliveries = {
        preset["id"]: DeliveryPhysicsSimulator.generate_delivery(preset["id"])
        for preset in DeliveryPhysicsSimulator.get_all_preset_deliveries()
    }
    output = ROOT / "frontend" / "src" / "utils" / "standardDeliveries.json"
    output.write_text(
        json.dumps(deliveries, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )
