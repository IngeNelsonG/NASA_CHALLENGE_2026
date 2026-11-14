"""ASGI entry point: `uvicorn brasa.main:app`."""

from brasa.api.app import create_app

app = create_app()
