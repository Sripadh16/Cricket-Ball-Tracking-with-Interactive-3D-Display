#!/usr/bin/env python3
"""
DRS Backend Server Startup Script
"""
import sys
import os
from importlib.util import find_spec

if __name__ == "__main__" and find_spec('ultralytics') is None:
    raise SystemExit('The ball detector dependency is missing in this Python environment. '
                     'Run python -m pip install -r requirements.txt, then restart the backend.')

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

import uvicorn
from main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
