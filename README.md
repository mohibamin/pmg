# PMG · Price Match Groceries

Search this week's grocery flyers at Walmart, Costco, Sobeys, FreshCo, Chalo FreshCo, Food Basics, No Frills and Iqbal Foods. See every price with its flyer clipping, the cheapest store per lb / L / item, and who will price match it.

Static site with no build step and no backend.

## How the data works

| Source | Stores | How |
|---|---|---|
| Flipp (`backflipp.wishabi.com`) | Walmart, Costco, Sobeys, FreshCo, Chalo FreshCo, Food Basics, No Frills | Fetched live in the browser for the visitor's postal code (CORS is open). Cached in localStorage for 6h. |
| `iqbalfoods.ca` specials | Iqbal Foods | `scripts/scrape_iqbal.py` writes `data/iqbal.json`. GitHub Actions runs it every Thursday (`.github/workflows/weekly-iqbal.yml`). |

Flipp is an unofficial API. If it changes, `js/core.js` is the only file that talks to it.

Price-match rules live in `js/stores.js` (checked Nov 2026). Update them there when policies change.

## Run locally

```sh
python -m http.server 8000
# open http://localhost:8000/#q=roma%20tomatoes
```

Refresh Iqbal specials by hand with `python scripts/scrape_iqbal.py`.

## Deploy (GitHub Pages, same as hsp.mohibamin.com)

1. Push to a GitHub repo, then go to Settings → Pages → deploy from `main` / root.
2. `CNAME` already contains `pmg.mohibamin.com`. Add a CNAME DNS record in Cloudflare pointing to `<user>.github.io`.
3. Settings → Actions → General → Workflow permissions: allow read and write so the weekly job can commit.

## Files

- `js/core.js`: Flipp/Iqbal loading, search ranking, unit-price maths. No DOM, so it can be tested in Node.
- `js/app.js`: UI rendering and events.
- `js/stores.js`: store list, colours, price-match policies.
- `css/style.css`: theme (mohibamin.com base with an emerald accent).
