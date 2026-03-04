"""FastAPI backend for the Chroma Explorer web application.

This module serves:
- the single-page frontend (`/`)
- JSON APIs for collection browsing/insights
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from chromadb import PersistentClient
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CHROMA_DIR = str(BASE_DIR / "chroma_db")

app = FastAPI(title="Chroma Explorer")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def _client(chroma_dir: str) -> Any:
    """Return a PersistentClient for the provided path or raise HTTP 400."""
    try:
        return PersistentClient(path=chroma_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not connect to '{chroma_dir}': {exc}") from exc


def _collection_names(client: Any) -> list[str]:
    """Return normalized collection names from a Chroma client."""
    names: list[str] = []
    for item in client.list_collections():
        if isinstance(item, str):
            names.append(item)
        elif hasattr(item, "name"):
            names.append(getattr(item, "name"))
    return sorted(set(names))


def _parse_where_json(where_json: str) -> dict[str, Any] | None:
    """Parse optional JSON filter payload and enforce object type."""
    if not where_json.strip():
        return None
    try:
        parsed = json.loads(where_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid filter JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Filter JSON must decode to an object.")
    return parsed


def _preview(text: str | None, max_len: int = 160) -> str:
    """Return compact text preview used in browse list cards."""
    if not text:
        return ""
    compact = " ".join(text.split())
    if len(compact) <= max_len:
        return compact
    return f"{compact[: max_len - 3]}..."


def _discover_candidate_paths() -> list[dict[str, Any]]:
    """Discover nearby `chroma_db` directories that contain at least one collection."""
    candidates: list[dict[str, Any]] = []
    roots = [BASE_DIR, BASE_DIR.parent]
    seen: set[str] = set()
    for root in roots:
        for child in root.iterdir():
            if not child.is_dir():
                continue
            possible = child / "chroma_db"
            sqlite_file = possible / "chroma.sqlite3"
            if not sqlite_file.exists():
                continue
            normalized = str(possible.resolve())
            if normalized in seen:
                continue
            seen.add(normalized)
            try:
                client = PersistentClient(path=normalized)
                names = _collection_names(client)
                if names:
                    candidates.append({"path": normalized, "collections": names})
            except Exception:
                continue
    return candidates


def _build_metadata_facets(metadatas: list[dict[str, Any] | None]) -> list[dict[str, Any]]:
    """Build key/value facet counts from sampled metadata documents."""
    key_counts: Counter[str] = Counter()
    value_counts: dict[str, Counter[str]] = defaultdict(Counter)
    value_examples: dict[str, dict[str, Any]] = defaultdict(dict)

    for meta in metadatas:
        if not isinstance(meta, dict):
            continue
        for key, value in meta.items():
            key_counts[key] += 1
            if isinstance(value, (str, int, float, bool)):
                normalized = str(value)
                value_counts[key][normalized] += 1
                value_examples[key][normalized] = value

    facets: list[dict[str, Any]] = []
    for key, count in key_counts.most_common():
        top_values = []
        for value_text, value_count in value_counts.get(key, Counter()).most_common(10):
            top_values.append(
                {
                    "value": value_examples[key].get(value_text),
                    "count": value_count,
                }
            )
        facets.append(
            {
                "key": key,
                "count": count,
                "top_values": top_values,
            }
        )
    return facets


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> Any:
    """Serve the main HTML application shell."""
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "default_chroma_dir": DEFAULT_CHROMA_DIR,
        },
    )


@app.get("/api/collections")
def collections(chroma_dir: str = Query(default=DEFAULT_CHROMA_DIR)) -> dict[str, Any]:
    """List collections and per-collection counts for a Chroma directory."""
    client = _client(chroma_dir)
    names = _collection_names(client)
    items: list[dict[str, Any]] = []
    for name in names:
        try:
            count = client.get_collection(name).count()
        except Exception:
            count = None
        items.append({"name": name, "count": count})
    return {"collections": items}


@app.get("/api/discover")
def discover() -> dict[str, Any]:
    """Discover likely local Chroma directories for easier onboarding."""
    return {"candidates": _discover_candidate_paths()}


@app.get("/api/collections/{collection_name}/browse")
def browse(
    collection_name: str,
    chroma_dir: str = Query(default=DEFAULT_CHROMA_DIR),
    limit: int = Query(default=25, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    id_contains: str = Query(default=""),
    where_json: str = Query(default=""),
) -> dict[str, Any]:
    """Browse paginated records from a collection with optional metadata/id filtering."""
    client = _client(chroma_dir)
    try:
        collection = client.get_collection(collection_name)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found: {exc}") from exc

    where = _parse_where_json(where_json)
    total = collection.count()
    payload = collection.get(
        limit=limit,
        offset=offset,
        where=where,
        include=["documents", "metadatas"],
    )
    ids = payload.get("ids", [])
    docs = payload.get("documents", [])
    metas = payload.get("metadatas", [])

    items: list[dict[str, Any]] = []
    for idx, item_id in enumerate(ids):
        item_id_text = str(item_id)
        if id_contains.strip() and id_contains.strip().lower() not in item_id_text.lower():
            continue
        doc = docs[idx] if idx < len(docs) else ""
        meta = metas[idx] if idx < len(metas) and metas[idx] else {}
        items.append(
            {
                "row": offset + idx,
                "id": item_id,
                "document": doc,
                "document_preview": _preview(doc),
                "metadata": meta,
                "metadata_keys": sorted(meta.keys()),
            }
        )

    return {"total": total, "limit": limit, "offset": offset, "items": items, "where": where}


@app.get("/api/collections/{collection_name}/insights")
def insights(
    collection_name: str,
    chroma_dir: str = Query(default=DEFAULT_CHROMA_DIR),
    sample_size: int = Query(default=120, ge=10, le=1000),
) -> dict[str, Any]:
    """Return metadata schema insights and facet counts for a collection sample."""
    client = _client(chroma_dir)
    try:
        collection = client.get_collection(collection_name)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found: {exc}") from exc

    sample = collection.get(limit=sample_size, include=["metadatas"])
    metadatas = sample.get("metadatas", [])
    keys = sorted({key for meta in metadatas if meta for key in meta.keys()})
    facets = _build_metadata_facets(metadatas=metadatas)
    return {
        "count": collection.count(),
        "metadata": collection.metadata or {},
        "metadata_keys": keys,
        "facets": facets,
    }







