# Scrapoo

Scrapoo is a focused web-scraping app. Paste a public webpage URL and it returns:

- The page title and meta description
- Headings
- Links
- Readable page text
- A downloadable JSON result

The user interface contains only the scraping workflow and its results.

## Run the app

```bash
pnpm install
pnpm run dev
```

Open the local URL shown in the terminal, enter a public HTTP or HTTPS URL, and select **Scrape page**.

## Optional queued crawler backend

The `backend/` folder contains the existing Django and Celery crawler for larger multi-page jobs. It remains separate from the simple one-page scraper interface.

```bash
docker compose up --build
```

## Responsible use

Only scrape pages you are authorized to access. Follow applicable law, site terms, robots policies, and the target website's capacity limits.
