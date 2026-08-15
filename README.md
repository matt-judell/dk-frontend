# dk-frontend

An interactive front end for exploring Danish company (CVR) fundamental data.

- **Landing page** — a [deck.gl](https://deck.gl) `IconLayer` on a MapLibre
  basemap plotting every entity at its **newest** registered location (one
  marker per CVR).
- **Detail page** — click a marker to open a page for that CVR with a table of
  `filing_date`, `assets`, `debt`, `cash`, `price`, `multiple`, plus a bar chart
  of **price over time**.

The whole thing is **static** — plain HTML/CSS/JS with no build step. The
parquet file (~11 MB) is loaded and parsed **entirely in the browser** using
[hyparquet](https://github.com/hyparam/hyparquet), so it can be hosted as a
GitHub Page with nothing but static files.

## Project layout

```
index.html            Landing page (map)
detail.html           Detail page (table + chart)
css/styles.css        Styles
js/data.js            Loads + normalizes the parquet, shared helpers
js/landing.js         Map / IconLayer logic
js/detail.js          Detail table + Chart.js bar chart
data/fundamental_data.pq   The dataset served to visitors
scripts/prepare_data.py    Refresh the committed data + print a QA report
requirements.txt      Python deps for the tooling above (not needed to run site)
.github/workflows/deploy.yml   GitHub Pages deployment
```

## Run it locally

The site needs to be served over HTTP (ES module imports and `fetch` do not
work from `file://`). Any static server works; Python's built-in one needs no
dependencies:

```bash
cd dk-frontend
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in your browser.

- The map appears immediately; markers show once the parquet finishes
  downloading and parsing (a few seconds on first load).
- Click any marker to open its detail page.

> An internet connection is required the first time you load the page: deck.gl,
> MapLibre, Chart.js and hyparquet are pulled from public CDNs, and the basemap
> tiles come from CARTO (no access token needed).

## Optional: Python tooling

You only need this to refresh `data/fundamental_data.pq` from the source of
truth or to inspect the dataset — the website does not use it.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# Copy the source parquet into data/ and print a quality report:
python scripts/prepare_data.py

# Or just inspect the committed copy without overwriting it:
python scripts/prepare_data.py --no-copy
```

The source path defaults to `~/.bizval/dk/fundamental_data.pq`; override it with
`--source /path/to/fundamental_data.pq`.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or `master`). The workflow in
   `.github/workflows/deploy.yml` uploads the repo root and publishes it.

Because paths in the app are all relative, it works whether Pages serves from a
root domain or a project sub-path (e.g. `https://user.github.io/dk-frontend/`).

## Notes & assumptions

- Monetary values (`assets`, `debt`, `cash`, `price`) are shown in the source
  units (DKK) with thousands separators; negative values are highlighted.
- Entities whose newest filing has no `longitude`/`latitude` are omitted from
  the map (they can't be placed), but all their filings still appear on the
  detail page.
- "Newest per CVR" is determined by `filing_date`.
