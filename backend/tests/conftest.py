"""Shared pytest configuration for all backend tests."""
import pytest


# Make FastAPI's TestClient and asyncio play nicely together
pytest_plugins = ("pytest_asyncio",)
