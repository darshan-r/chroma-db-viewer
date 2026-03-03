from __future__ import annotations

import argparse
import os

import uvicorn


def main() -> None:
    """Run the Chroma Explorer web server."""
    parser = argparse.ArgumentParser(description="Run Chroma Explorer server")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument(
        "--reload",
        action="store_true",
        default=os.getenv("RELOAD", "").strip().lower() in {"1", "true", "yes"},
        help="Enable autoreload for development.",
    )
    args = parser.parse_args()

    uvicorn.run("app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
