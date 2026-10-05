# WTRBA Stream Gages Dashboard

Static GitHub Pages dashboard for WTRBA stream-gage data exposed through the TN Tech Grafana datasource proxy.

## Files

- `index.html` – dashboard markup
- `styles.css` – responsive styling
- `app.js` – live-data fetching, calculations, and chart rendering
- `stations.js` – station configuration

## Deploy to Raven Insights

Copy the entire `stream-gages` folder into your GitHub repository, for example:

```text
raven-insights/
  index.html
  stream-gages/
    index.html
    styles.css
    app.js
    stations.js
```

Then commit and push. With GitHub Pages enabled, the page should be available at a URL similar to:

```text
https://YOUR-USERNAME.github.io/raven-insights/stream-gages/
```

## Current Lone Oaks configuration

- Water level variable: `361`
- Water query: `mean(value) / 12`
- Water aggregation: `15m`
- Battery variable: `364`
- Battery aggregation: `5m`

## Battery multiplier

The battery feed sample contained values around `0.60`, `0.59`, etc., but the old Grafana panel used a 40–100 y-axis. For safety the starter config currently uses:

```js
multiplier: 1
```

If you confirm `0.60` means 60%, change this in `stations.js` to:

```js
multiplier: 100
```

## CORS

The dashboard calls:

```text
https://chordsrtf.tntech.edu/api/datasources/proxy/1/query
```

directly from the browser. If the GitHub Pages deployment shows the CORS error banner while the same URL works when opened directly, the next step is to add a small serverless proxy (Cloudflare Worker, Netlify Function, etc.). No database is required.
