# Contributing

Thanks for contributing to Chroma Explorer.

## Development Setup

```powershell
uv sync --extra dev
uv run python main.py --reload
```

## Before Opening a PR

1. Run compile check:
   `uv run python -m py_compile app.py main.py`
1. Manually verify:
   - collection load
   - browse pagination
   - search flow
   - insights/facets
   - health panel
1. Update docs if behavior changes.

## Code Guidelines

- Keep backend dependencies minimal.
- Keep frontend framework-free unless discussed first.
- Preserve accessibility affordances:
  - keyboard navigable controls
  - clear focus states
  - readable contrast
- Avoid introducing slow startup checks into default flow.

## Commit Guidelines

- Use small, focused commits.
- Write clear commit messages in imperative voice.
- Include rationale in PR description for non-trivial UX/API changes.
