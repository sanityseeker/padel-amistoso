"""Legacy pages must keep a stored language they cannot show (Russian) instead of overwriting it."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tests" / "js" / "legacy_language.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_legacy_shared_js_language_persistence() -> None:
    done = subprocess.run(["node", str(SCRIPT), str(ROOT)], capture_output=True, text=True, check=True, timeout=60)
    results = json.loads(done.stdout.strip().splitlines()[-1])
    failed = [r["name"] for r in results if not r["ok"]]
    assert results and not failed, failed
