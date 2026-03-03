# Security Policy

## Reporting a Vulnerability

Please report security issues privately before opening a public issue.

Include:
- affected version/commit
- reproduction steps
- potential impact

## Scope Notes

This project runs against local Chroma data by default. If you deploy it on a network:
- restrict host binding and access control
- avoid exposing local filesystem paths publicly
- review logs for sensitive metadata/document leakage
