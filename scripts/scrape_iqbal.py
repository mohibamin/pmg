"""Scrape Iqbal Foods' weekly specials into data/iqbal.json.

Iqbal isn't on Flipp and its site blocks cross-origin requests, so this runs
weekly in GitHub Actions instead of in the browser. Standard library only.
"""
import html
import json
import math
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://iqbalfoods.ca"
SPECIALS = BASE + "/shop?special_items=discount"
OUT = Path(__file__).resolve().parent.parent / "data" / "iqbal.json"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (PMG weekly price check)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def money(text):
    m = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
    return float(m.group(1)) if m else None


def parse(page):
    items = []
    # Category headings (<h6>) sit before each product grid; track the latest one.
    tokens = re.split(r'(<div class="product_list_heading[^>]*><h6>.*?</h6>|class="my-3 single_product_theme)', page)
    category = None
    i = 1
    while i < len(tokens):
        marker, body = tokens[i], tokens[i + 1] if i + 1 < len(tokens) else ""
        i += 2
        if marker.startswith("<div"):
            category = html.unescape(re.sub(r"<[^>]+>", "", marker)).strip()
            continue
        body = re.sub(r"style='[^']*'", "", body)
        pid = re.search(r"product-card-(\d+)", body)
        name = re.search(r"alt='([^']*)'", body)
        img = re.search(r"src='(https://static\.tossdown\.com/[^']*)'", body)
        href = re.search(r"href='(/product/[^']*)'", body)
        prices = dict(
            (cls, money(re.sub(r"<[^>]+>", " ", txt)))
            for cls, txt in re.findall(r"<p class='(orginal_price|text_decoration_line_through)[^>]*>(.*?)</p>", body, re.S)
        )
        price = prices.get("orginal_price")  # Tossdown's (misspelled) class for the current price
        if not (pid and name and price):
            continue
        items.append({
            "id": int(pid.group(1)),
            "name": html.unescape(name.group(1)).strip(),
            "price": price,
            "regular": prices.get("text_decoration_line_through"),
            "image": img.group(1) if img else None,
            "url": BASE + href.group(1) if href else BASE,
            "category": category,
        })
    total = re.search(r"const totalItems = (\d+)", page)
    per_page = re.search(r"const itemsPerPage = (\d+)", page)
    pages = math.ceil(int(total.group(1)) / int(per_page.group(1))) if total and per_page else 1
    return items, pages


def main():
    items, pages = parse(fetch(SPECIALS))
    for n in range(2, pages + 1):
        items += parse(fetch(f"{SPECIALS}&page_no={n}"))[0]
    seen, unique = set(), []
    for it in items:
        if it["id"] not in seen:
            seen.add(it["id"])
            unique.append(it)
    if not unique:
        sys.exit("No specials parsed. The page layout may have changed; keeping the old data.")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SPECIALS,
        "items": unique,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(unique)} Iqbal specials to {OUT}")


if __name__ == "__main__":
    main()
