# Scrapoo

Scrapoo is a professional web-scraping control plane built around the problems users repeatedly report in existing tools: unpredictable cost, silent selector breakage, unclear failures, block-related waste, and too much operational babysitting.

The product includes:

- A responsive React + Tailwind operations interface
- Django REST API with JWT authentication and owner-scoped data
- PostgreSQL models for projects, runs, pages, field health, and crawl events
- Celery + Redis workers and scheduled-job infrastructure
- HTTP and optional Playwright rendering
- Spend, page, depth, response-size, redirect, retry, and time guards
- `robots.txt` support, public-network validation, domain scoping, throttling, and an identifiable user agent
- CSS selector fallbacks, JSON-LD semantic fallback, field-health scoring, and selector-drift warnings
- Containerized local stack and automated tests

The research behind these choices is in [docs/MARKET_RESEARCH.md](docs/MARKET_RESEARCH.md). System boundaries and production hardening are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start with Docker

1. Copy `.env.example` to `.env` and replace the secret values.
2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Create the first administrator:

   ```bash
   docker compose exec backend python manage.py createsuperuser
   ```

4. Open `http://localhost:3000` for the control plane and `http://localhost:8000/admin/` for Django administration.

The API health endpoint is `GET /health/`. Obtain a JWT with `POST /api/auth/token/`, then send `Authorization: Bearer <access-token>` to protected endpoints.

## Local development without Docker

Frontend:

```bash
pnpm install
pnpm run dev
```

Backend:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
.venv/Scripts/python backend/manage.py migrate
.venv/Scripts/python backend/manage.py runserver
```

Run a Redis server and start the worker from `backend/`:

```bash
celery -A scrapoo worker -Q crawls -l INFO
```

SQLite is the zero-configuration development fallback. Set `DATABASE_URL` to PostgreSQL for the intended production configuration.

## Core API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/token/` | Exchange Django credentials for access and refresh tokens |
| `GET, POST /api/projects/` | List or create crawler projects |
| `POST /api/projects/{id}/run/` | Queue a guarded crawl |
| `GET /api/runs/` | Inspect crawl progress, cost, health, events, and field metrics |
| `POST /api/runs/{id}/cancel/` | Request cooperative cancellation |
| `GET /api/pages/?run={id}` | Browse extracted pages |
| `GET /api/dashboard/` | Retrieve control-plane summary data |

Example extraction schema:

```json
{
  "title": {"selector": "h1", "required": true},
  "price.current": {
    "selector": "[data-price]",
    "fallback_selectors": [".price", "meta[property='product:price:amount']"],
    "attribute": "content",
    "semantic_key": "price",
    "type": "number",
    "required": true
  }
}
```

## Responsible use

Only collect data you are authorized to access. Follow applicable law, contractual terms, privacy obligations, robots policy, and the target site's capacity constraints. Scrapoo intentionally does not bypass CAPTCHAs, scrape private network addresses, or make “works on every site” claims.
