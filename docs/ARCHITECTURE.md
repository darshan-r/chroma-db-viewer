# Architecture

## Overview

Chroma Explorer is a thin web app with:
- FastAPI backend for data access
- static HTML/CSS/JS frontend for interaction and rendering
- local ChromaDB storage as system of record

## Backend Responsibilities

`app.py` exposes endpoints for:
- listing collections
- browsing paged records
- metadata insights/facets

The backend intentionally avoids long-lived state; frontend handles interaction state and lightweight caching.

## Frontend Responsibilities

`static/app.js` handles:
- workspace and URL state synchronization
- panel-level error reporting
- browse UX
- CSV export
- infinite scroll mode
- short-lived request cache

`templates/index.html` is the single-page shell.

`static/styles.css` defines visual system, responsiveness, and accessibility-focused focus states.

## Performance Design

- Request cache is TTL-based and local to browser session.
- Browse views render skeleton placeholders while loading.
- Facet generation is sample-based, not full-scan.

## Extension Points

- Add authentication middleware before deploying publicly.
- Add server-side export endpoints for full-result exports.
- Add test suite for endpoint regression protection.



