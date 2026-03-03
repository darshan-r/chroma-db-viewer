"""FastAPI backend for the Chroma Explorer web application.

This module serves:
- the single-page frontend (`/`)
- JSON APIs for collection browsing/search/insights/health
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from chromadb import PersistentClient
from chromadb.utils import embedding_functions
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CHROMA_DIR = str(BASE_DIR / "chroma_db")
DEFAULT_EMBEDDING_MODEL = "all-MiniLM-L6-v2"

app = FastAPI(title="Chroma Explorer")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class SearchRequest(BaseModel):
    """Payload for semantic search requests."""

    chroma_dir: str = Field(default=DEFAULT_CHROMA_DIR)
    query: str = Field(min_length=1)
    top_k: int = Field(default=8, ge=1, le=50)
    embedding_model: str = Field(default=DEFAULT_EMBEDDING_MODEL)
    where_json: str = Field(default="")


def _client(chroma_dir: str) -> PersistentClient:
    """Return a PersistentClient for the provided path or raise HTTP 400."""
    try:
        return PersistentClient(path=chroma_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not connect to '{chroma_dir}': {exc}") from exc


def _collection_names(client: PersistentClient) -> list[str]:
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
    """Return compact text preview used in browse/search list cards."""
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
            "default_embedding_model": DEFAULT_EMBEDDING_MODEL,
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


@app.post("/api/collections/{collection_name}/search")
def search(collection_name: str, payload: SearchRequest) -> dict[str, Any]:
    """Run semantic search against a collection and return ranked matches."""
    client = _client(payload.chroma_dir)
    where = _parse_where_json(payload.where_json)

    try:
        embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=payload.embedding_model
        )
        collection = client.get_collection(collection_name, embedding_function=embedder)
        result = collection.query(
            query_texts=[payload.query],
            n_results=payload.top_k,
            where=where,
            include=["distances", "documents", "metadatas"],
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Search failed: {exc}") from exc

    ids = result.get("ids", [[]])[0]
    docs = result.get("documents", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    dists = result.get("distances", [[]])[0]

    matches: list[dict[str, Any]] = []
    for idx, item_id in enumerate(ids):
        matches.append(
            {
                "rank": idx + 1,
                "id": item_id,
                "distance": dists[idx] if idx < len(dists) else None,
                "document": docs[idx] if idx < len(docs) else "",
                "document_preview": _preview(docs[idx] if idx < len(docs) else ""),
                "metadata": metas[idx] if idx < len(metas) else {},
            }
        )

    return {"matches": matches}


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


@app.get("/api/health")
def health(
    chroma_dir: str = Query(default=DEFAULT_CHROMA_DIR),
    collection_name: str = Query(default=""),
    embedding_model: str = Query(default=DEFAULT_EMBEDDING_MODEL),
    include_embedding_check: bool = Query(default=False),
) -> dict[str, Any]:
    """Run health diagnostics for path, collection, and optional embedding compatibility."""
    checks: dict[str, Any] = {
        "path_exists": False,
        "db_file_exists": False,
        "db_connectable": False,
        "collections_count": 0,
        "collection_accessible": None,
        "embedding_model_loadable": None,
        "query_compatible": None,
        "errors": [],
    }

    path = Path(chroma_dir)
    checks["path_exists"] = path.exists()
    checks["db_file_exists"] = (path / "chroma.sqlite3").exists()

    try:
        client = _client(chroma_dir)
        checks["db_connectable"] = True
        collections = _collection_names(client)
        checks["collections_count"] = len(collections)
    except HTTPException as exc:
        checks["errors"].append(str(exc.detail))
        return checks

    embedder = None
    if include_embedding_check:
        try:
            embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
                model_name=embedding_model
            )
            checks["embedding_model_loadable"] = True
        except Exception as exc:
            checks["embedding_model_loadable"] = False
            checks["errors"].append(f"Embedding model issue: {exc}")

    if collection_name.strip():
        try:
            if embedder is not None:
                collection = client.get_collection(collection_name, embedding_function=embedder)
            else:
                collection = client.get_collection(collection_name)
            checks["collection_accessible"] = True
            if include_embedding_check and embedder is not None and collection.count() > 0:
                collection.query(query_texts=["health check"], n_results=1)
                checks["query_compatible"] = True
            elif include_embedding_check and embedder is not None:
                checks["query_compatible"] = True
        except Exception as exc:
            checks["collection_accessible"] = False
            checks["query_compatible"] = False
            checks["errors"].append(f"Collection/query check failed: {exc}")

    return checks
