"""Vercel Function: the whole FastAPI backend, served under /api/* next to the Vite site.

vercel.json rewrites every /api/... request to this file and bundles backend/src and
backend/data with it. Dependencies come from the root requirements.txt.
"""

import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))
os.environ.setdefault("BRASA_DATA_DIR", str(ROOT / "backend" / "data"))
os.environ.setdefault("BRASA_ENVIRONMENT", "production")

from brasa.main import app as brasa_app  # noqa: E402

# The rewrite also passes the original path as ?__path=… . Vercel normally keeps the original
# request path, so this is only a safety net in case the function sees /api/index instead.
_OWN_PATHS = {"/api", "/api/index", "/api/index.py"}


async def app(scope, receive, send):  # type: ignore[no-untyped-def]
    if scope["type"] == "http":
        query = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
        original = next((v for k, v in query if k == "__path"), None)
        if original is not None:
            scope = dict(scope, query_string=urlencode([(k, v) for k, v in query if k != "__path"]).encode())
            if scope["path"] in _OWN_PATHS:
                path = "/api/" + original.lstrip("/")
                scope.update(path=path, raw_path=path.encode())
    await brasa_app(scope, receive, send)
