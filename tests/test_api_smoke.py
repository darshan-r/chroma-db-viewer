"""Smoke tests for core API behavior."""

from __future__ import annotations

import sys
from pathlib import Path
import numpy as np

from fastapi.testclient import TestClient
from chromadb import PersistentClient

# Ensure repository root is importable when tests run in isolated environments.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app


def _seed_test_collection(path: str) -> None:
    client = PersistentClient(path=path)
    collection = client.get_or_create_collection("smoke_collection")
    collection.add(
        ids=["1", "2", "3"],
        documents=["alpha document", "beta document", "gamma document"],
        metadatas=[
            {"source": "a.md", "topic": "alpha"},
            {"source": "b.md", "topic": "beta"},
            {"source": "a.md", "topic": "gamma"},
        ],
        embeddings=np.array([[0.1, 0.2], [0.15, 0.25], [0.2, 0.3]], dtype=np.float32),
    )


def test_core_endpoints_smoke(tmp_path: Path) -> None:
    db_path = str(tmp_path / "chroma_db")
    _seed_test_collection(db_path)
    client = TestClient(app)

    r_collections = client.get("/api/collections", params={"chroma_dir": db_path})
    assert r_collections.status_code == 200
    collections = r_collections.json()["collections"]
    assert any(c["name"] == "smoke_collection" for c in collections)

    r_browse = client.get(
        "/api/collections/smoke_collection/browse",
        params={"chroma_dir": db_path, "limit": 2, "offset": 0},
    )
    assert r_browse.status_code == 200
    assert len(r_browse.json()["items"]) == 2

    r_insights = client.get(
        "/api/collections/smoke_collection/insights",
        params={"chroma_dir": db_path, "sample_size": 50},
    )
    assert r_insights.status_code == 200
    payload = r_insights.json()
    assert "metadata_keys" in payload
    assert "facets" in payload





