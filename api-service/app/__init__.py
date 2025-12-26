"""API service package setup."""

import sys
from pathlib import Path

# Ensure local shared package is importable without installation
_ROOT = Path(__file__).resolve().parents[2]
_SHARED = _ROOT / "shared"
if str(_SHARED) not in sys.path:
	sys.path.append(str(_SHARED))
