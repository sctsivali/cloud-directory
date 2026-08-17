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

## License

Source is public for review and correction. See the site footer and `/correct`.
