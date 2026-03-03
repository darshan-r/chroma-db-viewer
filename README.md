# Chroma Explorer

Modern, local-first web application to explore ChromaDB collections with a clean FastAPI + vanilla frontend stack.

## Why This Project

Working directly with Chroma collections can be awkward when you need quick visibility into:
- what data actually exists,
- which metadata keys/values are available,
- whether semantic search is configured correctly.

Chroma Explorer provides a lightweight interface to browse, inspect, and search your local vector store without adding a heavy frontend framework.

## Core Features

- Collection discovery and quick path switching for local `chroma_db` directories
- Browse records with pagination or optional infinite scroll
- Record drilldown with full document and metadata
- Semantic search with optional metadata JSON filter
- Metadata insights:
  - detected keys
  - facet values with one-click filter application
- Health diagnostics:
  - DB path/file/connectivity
  - collection accessibility
  - optional embedding/query compatibility
- Saved query presets (browser local storage)
- URL-shareable app state (path, collection, tab, filters, query)
- CSV export for browse and search results

## Tech Stack

- Backend: FastAPI
- Frontend: HTML/CSS/JavaScript (no framework)
- Vector DB: ChromaDB
- Embeddings for semantic search: sentence-transformers
- Runtime and dependency management: `uv`

## Quickstart (UV)

```powershell
cd C:\codex\chroma-explorer
uv sync
uv run python main.py --reload
```

Open: `http://127.0.0.1:8000`

Production-style run (no autoreload):

```powershell
uv run python main.py
```

## CLI Options

```powershell
uv run python main.py --host 0.0.0.0 --port 8000 --reload
```

Environment variable alternatives:
- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8000`)
- `RELOAD` (`1|true|yes` enables reload)

## Using Your Existing Chroma Data

1. Start app.
1. Set **Chroma DB Path** to your existing directory (e.g. `C:\codex\local-rag\chroma_db`).
1. Click **Apply**.
1. Select a collection.

If the path has no collections, the app shows detected candidate paths you can switch to with one click.

## API Endpoints

- `GET /api/collections`
- `GET /api/discover`
- `GET /api/collections/{collection_name}/browse`
- `POST /api/collections/{collection_name}/search`
- `GET /api/collections/{collection_name}/insights`
- `GET /api/health`

Interactive API docs are available at:
- `http://127.0.0.1:8000/docs`

## Repository Layout

```text
app.py                  # FastAPI app + API endpoints
main.py                 # CLI server entrypoint
templates/index.html    # Application shell
static/styles.css       # UI styles
static/app.js           # Frontend behavior/state
tests/                  # Smoke tests
docs/ARCHITECTURE.md    # System design notes
```

## Development

Install with dev dependencies:

```powershell
uv sync --extra dev
```

Smoke compile:

```powershell
uv run python -m py_compile app.py main.py
```

Run tests:

```powershell
uv run pytest -q
```

## Roadmap

- Virtualized browsing for very large pages
- Full-dataset server-side export
- End-to-end automated tests

## License

MIT. See [LICENSE](./LICENSE).
