# Cloud Directory (Next.js)

Editorial cloud directory for ASEAN — live at [guide.cloudin.asia](https://guide.cloudin.asia).

This is the **TypeScript / Next.js** product. It is not a vendor marketplace and not a compliance certificate.

## Stack

- Next.js 15 + React 19 + TypeScript
- PostgreSQL 16
- Docker Compose

## Run locally

```bash
cp .env.example .env
# edit passwords in .env
cd web && npm install && npm run build
cd ..
docker compose up -d
```

App: `http://127.0.0.1:3001`  
Database: `127.0.0.1:5433`

On a small host, use `npm run start` (production). Do not run `next dev` on 2 CPU / 4 GB.

## What this is

Cloud in Asia is the media/ecosystem. **Cloud Directory** is this product: compare providers, data-centre locations, and stacks from public evidence.

Unknown is unknown. We do not invent building names, photos, or legal conclusions.

## Schema

PostgreSQL migrations live in `migrations/` with a checksum ledger (`migrations/manifest.json`, currently schema version 8). Apply with an explicit URL:

```bash
python scripts/migrate.py --database-url "$TEST_DATABASE_URL"
python scripts/migrate.py --verify-manifest
python scripts/migrate_legacy_data.py --database-url "$TEST_DATABASE_URL"
```

`migrate_legacy_data.py` copies existing public rows into Phase 2 catalog/claim tables as `legacy/unverified`. It does not change public scoring.

The built-in MCP server (`mcp/`, official SDK, contract `cloud-directory-mcp` 1.0.0) can read the directory and submit typed proposals. It cannot publish or run SQL. See `docs/mcp-contract.md`.

## License

Source is public for review and correction. See the site footer and `/correct`.
