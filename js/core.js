// Data loading, search and price normalisation. No DOM code here, so it runs in Node too.
import { STORES } from "./stores.js?v=20261102";

const FLIPP = "https://backflipp.wishabi.com/flipp";
const CACHE_TTL = 6 * 60 * 60 * 1000; // flyers change weekly; 6h keeps things snappy

// ── Cache (localStorage, best-effort) ───────────────────────────────
function cacheGet(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < CACHE_TTL ? v : null;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* full or blocked */ }
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
const https = (u) => (u ? u.replace(/^http:/, "https:") : null);
export const cleanPostal = (p) => (p || "").toUpperCase().replace(/\s+/g, "");
export const validPostal = (p) => /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(cleanPostal(p));

// ── Flipp flyers ────────────────────────────────────────────────────
const FLIPP_TO_STORE = Object.fromEntries(
  Object.entries(STORES).filter(([, s]) => s.flipp).map(([k, s]) => [s.flipp, k])
);

export async function loadFlyers(postal) {
  const key = `ff:flyers:v4:${postal}`; // bump when the store list changes
  let flyers = cacheGet(key);
  if (!flyers) {
    const data = await getJSON(`${FLIPP}/data?locale=en-ca&postal_code=${postal}`);
    flyers = (data.flyers || [])
      .map((f) => ({ ...f, store: FLIPP_TO_STORE[norm(f.merchant)] }))
      .filter((f) => f.store)
      // Walmart runs toy/home flyers too; keep its grocery ones. Costco's main savings
      // flyer is tagged "Home & Garden" but holds most of its food deals, so keep all of Costco's.
      .filter((f) => f.store !== "walmart" || (f.categories || []).includes("Groceries"))
      .map((f) => ({ id: f.id, store: f.store, from: f.valid_from, to: f.valid_to, name: f.name || f.merchant }));
    cacheSet(key, flyers);
  }
  // Dates are checked on every call, not at cache time, so a flyer that ends while
  // cached drops out on time.
  const now = Date.now();
  const live = flyers.filter((f) => new Date(f.to) >= now);
  const current = live.filter((f) => new Date(f.from) <= now);
  // A store between flyers shows its next one early, marked as upcoming.
  const upcoming = live
    .filter((f) => new Date(f.from) > now && !current.some((c) => c.store === f.store))
    .map((f) => ({ ...f, upcoming: true }));
  return current.concat(upcoming);
}

export const isFuture = (d) => !!d && new Date(d) > Date.now();

export async function loadFlyerItems(flyer) {
  const key = `ff:items:v3:${flyer.id}`; // bump when the item shape or filter changes
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await getJSON(`${FLIPP}/flyers/${flyer.id}?locale=en-ca`);
  const items = (data.items || [])
    .filter((i) => i.name && parseFloat(i.price) > 0 && !/^[A-Z0-9_-]{8,}$/.test(i.name.trim())) // skip $0 promos and banner codes like "CSTCG1026…"
    .map((i) => ({
      id: i.id,
      store: flyer.store,
      name: i.name,
      brand: i.brand || "",
      price: parseFloat(i.price),
      discount: i.discount || 0, // % off regular, when the flyer says
      image: https(i.cutout_image_url),
      validTo: i.valid_to || flyer.to,
      startsAt: i.valid_from || flyer.from,
      source: "flipp",
    }));
  cacheSet(key, items);
  return items;
}

// Unit text ("/lb", "3/") and sale copy only come from the per-item endpoint,
// so it is fetched for the results being shown.
export async function loadDetails(id) {
  const key = `ff:item:${id}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const { item: d } = await getJSON(`${FLIPP}/items/${id}?locale=en-ca`);
  const details = {
    pre: d.pre_price_text || "",
    post: d.price_text || "",
    original: d.original_price ? parseFloat(d.original_price) : null,
    sale: d.sale_story || "",
    description: d.description || "",
    link: d.ttm_url || null,
  };
  cacheSet(key, details);
  return details;
}

// One Flipp search call returns unit text for most of a query's items at once,
// which saves a per-item request for each of them.
export async function searchDetails(query, postal) {
  const data = await getJSON(`${FLIPP}/items/search?locale=en-ca&postal_code=${postal}&q=${encodeURIComponent(query)}`);
  const map = new Map();
  for (const i of data.items || []) {
    map.set(i.flyer_item_id || i.id, {
      pre: i.pre_price_text || "",
      post: i.post_price_text || "",
      original: i.original_price ? parseFloat(i.original_price) : null,
      sale: i.sale_story || "",
      description: "",
      link: null,
    });
  }
  return map;
}

// ── Iqbal (scraped weekly by GitHub Actions) ────────────────────────
export async function loadIqbal(base = "") {
  const data = await getJSON(`${base}data/iqbal.json`);
  return {
    updated: data.updated,
    items: data.items.map((i) => ({
      id: `iq${i.id}`,
      store: "iqbal",
      name: i.name,
      brand: "",
      price: i.price,
      discount: i.regular > i.price ? Math.round((1 - i.price / i.regular) * 100) : 0,
      image: i.image,
      validTo: null,
      source: "iqbal",
      category: i.category || "",
      details: { pre: "", post: "", original: i.regular, sale: i.regular ? `Reg. $${i.regular.toFixed(2)}` : "", description: i.category || "", link: i.url },
    })),
  };
}

// ── Search ──────────────────────────────────────────────────────────
const STOP = new Set(["and", "or", "the", "of", "a", "with", "for", "in"]);

export function stem(w) {
  w = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const words = (s) => (s || "").split(/[^A-Za-z0-9]+/).map(stem).filter((w) => w && !STOP.has(w));

const tokenHit = (q, toks) => toks.some((t) => t === q || (q.length >= 3 && t.startsWith(q)) || (t.length >= 4 && q.startsWith(t)));

// Words that turn a fresh ingredient into a different product ("tomato" -> "tomato sauce").
// They push an item down unless the search itself asks for them.
const PROCESSED = new Set(words(`sauce paste soup chips flavour flavor bar chocolate cake juice pasta beans puree ketchup
  cookies candy drink cereal pizza dip seasoning snack waffles nuggets rolls bites sandwiches entrees rusk treats
  biscuits shake crackers noodles spread pan pie`));

// Tier 1: every query word appears as a whole word and it isn't a processed product
//         (the item you meant). Tier 2: every word matches, loosely ("egg" ~ "eggo").
// Tier 3: only the last word, the noun, matches ("roma tomatoes" -> "tomato"),
//         a fallback for stores with nothing better.
export function scoreItem(item, qWords) {
  const toks = words(`${item.name} ${item.brand}`);
  if (!qWords.length || !toks.length) return null;
  const hits = qWords.filter((q) => tokenHit(q, toks));
  const lenPenalty = Math.min(toks.length, 30);
  const nameToks = words(item.name); // brand alone ("Milk-Bone") shouldn't make it the item you meant
  const whole = qWords.every((q) => nameToks.includes(q));
  const processed = toks.filter((t) => PROCESSED.has(t) && !qWords.includes(t)).length;
  if (hits.length === qWords.length) {
    const phrase = qWords.join(" ");
    const bonus = toks.join(" ").includes(phrase) ? 15 : 0;
    const lead = tokenHit(qWords[0], toks.slice(0, 3)) ? 5 : 0;
    const tier = whole && !processed ? 1 : 2;
    return { kind: "exact", tier, score: 100 + bonus + lead + (whole ? 10 : 0) - lenPenalty - processed * 30 };
  }
  const head = qWords[qWords.length - 1];
  if (qWords.length > 1 && tokenHit(head, toks)) return { kind: "related", tier: 3, processed, score: 40 + hits.length * 5 - lenPenalty - processed * 30 };
  return null;
}

export function search(items, query) {
  const qWords = words(query);
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const s = scoreItem(it, qWords);
    if (!s) continue;
    const dupe = `${it.store}|${it.name.toLowerCase()}|${it.price}`; // flyers often repeat an item on two pages
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    out.push({ ...it, ...s });
  }
  return out.sort((a, b) => a.tier - b.tier || b.score - a.score || a.price - b.price);
}

// The items a "cheapest" verdict should be judged on: the best tier anyone has.
// Unprocessed closest matches beat processed ones ("tomatoes" over "tomato soup").
export function verdictPool(results) {
  for (const tier of [1, 2]) {
    const rs = results.filter((r) => r.tier === tier);
    if (rs.length) return rs;
  }
  const clean = results.filter((r) => !r.processed);
  return clean.length ? clean : results;
}

// ── Categories ──────────────────────────────────────────────────────
// Flipp items carry no category, so they're sorted by keywords in the name.
// Rules run top to bottom and the first hit wins, which is why "tomato sauce"
// lands in pantry before the vegetable rule sees "tomato".
export const CATEGORIES = [
  { key: "veg", label: "Vegetables" },
  { key: "fruit", label: "Fruit" },
  { key: "meat", label: "Meat & Seafood" },
  { key: "dairy", label: "Dairy & Eggs" },
  { key: "bakery", label: "Bakery" },
  { key: "pantry", label: "Pantry" },
  { key: "frozen", label: "Frozen" },
  { key: "snacks", label: "Snacks & Sweets" },
  { key: "drinks", label: "Drinks" },
  { key: "household", label: "Household & Care" },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]).concat([["other", "Other"]]));

const PHRASES = [[/peanut butter/g, "peanutbutter"], [/ice cream/g, "icecream"], [/k-?cups?/g, "kcup"], [/paper towels?/g, "papertowel"], [/(dog|cat) food/g, "petfood"], [/chocolate milk/g, "chocmilk"], [/(grape|cherry) tomato/g, "tomato"], [/vitamin ?water/g, "water"], [/coffee makers?|kettles?|blenders?|air fryers?/g, "appliance"], [/cream sella/g, "sella rice"]];
const CAT_RULES = [
  ["household", `tissue papertowel napkin detergent soap shampoo conditioner toothpaste toothbrush diaper wipes vitamin supplement
    deodorant lotion razor bleach cleaner garbage foil battery litter petfood pedigree cesar whiskas friskies purina pet pad tampon
    tylenol advil robitussin nicorette nicotine cosmetic makeup candle plant flower bouquet charcoal laundry dish dishwasher softener
    sanitizer mouthwash floss wash cologne perfume underwear ziploc appliance`],
  ["pantry", "sauce paste soup ketchup canned pickle pickles peanutbutter salsa gravy broth stock cereal cheerios shreddies"],
  ["frozen", "frozen icecream popsicle fries superfries pizza nuggets waffles perogies pierogi entree samosa"],
  ["drinks", `juice pop soda cola pepsi coke sprite water coffee tea kombucha beverage drink lemonade gatorade beer wine sparkling
    smoothie kcup espresso`],
  ["snacks", "chips crisps popcorn pretzel straws snax lays doritos ruffles cheetos pringles"],
  ["bakery", `bread bun bagel croissant muffin tortilla naan pita roti cake donut doughnut pie loaf baguette danish brioche rusk
    toast pastry pastries crumpet`],
  ["snacks", `cookie cookies chocolate candy gum cracker bar granola snack nut almond cashew peanut pistachio jerky gummy mithai
    halwa rasmalai burfi laddu biscuit oreo marshmallow licorice treats brownie dip`],
  ["dairy", "chocmilk milk cheese yogurt yogourt butter egg cream creamer kefir paneer ghee brie cheddar mozzarella parmesan feta margarine dahi lassi"],
  ["meat", `chicken beef pork lamb goat veal turkey ham bacon sausage steak rib wing drumstick thigh breast fish salmon tilapia cod
    shrimp prawn keema mince ground chop chops loin roast meatball haddock trout basa crab lobster seafood wiener deli scallop`],
  ["fruit", `apple banana orange grape strawberry blueberry raspberry blackberry berry mango pear peach plum nectarine lemon lime
    melon watermelon cantaloupe pineapple kiwi cherry clementine mandarin pomegranate papaya guava avocado coconut date fig grapefruit`],
  ["veg", `tomato potato onion carrot lettuce cucumber pepper broccoli cauliflower spinach celery garlic ginger mushroom corn cabbage
    zucchini squash eggplant okra kale cilantro coriander salad asparagus beet radish turnip leek pea yam bok choy chili chilli
    herb parsley vegetable veggie`],
  ["pantry", `rice pasta spaghetti flour atta oil cereal oat oatmeal sugar salt spice masala bean lentil dal daal chickpea mustard
    mayo mayonnaise jam honey syrup noodle vinegar stock broth tuna seasoning poha suji semolina besan macaroni ramen`],
].map(([cat, list]) => [cat, new Set(words(list))]);

// Iqbal's own site categories, used before the keyword rules.
const IQBAL_CATS = [
  [/health|beauty|household|clean/i, "household"], [/frozen/i, "frozen"], [/snack|sweet|cand|chocolate|cookie/i, "snacks"],
  [/bakery/i, "bakery"], [/meat|chicken|beef|goat|lamb|veal|fish|seafood/i, "meat"], [/dairy/i, "dairy"],
  [/tea|coffee|beverage|drink|juice/i, "drinks"],
];

export function categorize(item) {
  if (item.category) {
    const hit = IQBAL_CATS.find(([re]) => re.test(item.category));
    if (hit) return hit[1];
  }
  let name = item.name.toLowerCase();
  for (const [re, w] of PHRASES) name = name.replace(re, w);
  const toks = words(name);
  for (const [cat, set] of CAT_RULES) if (toks.some((t) => set.has(t))) return cat;
  if (/fruit|vegetable/i.test(item.category || "")) return "veg";
  return item.category ? "pantry" : "other";
}

// ── Prices ──────────────────────────────────────────────────────────
const LB_PER_KG = 2.20462;
const G_PER_LB = 453.592;

// Pack size from the item name, e.g. "7 lb", "340 g", "2 L", "796 mL", "12 x 355 mL".
// Ranges ("540-796 mL") are skipped: we can't tell which size the price is for.
export function packSize(text) {
  const t = (text || "").toLowerCase();
  if (/\d\s*-\s*\d+(\.\d+)?\s*(g|kg|lb|ml|l)\b/.test(t)) return null;
  const m = t.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|lbs?|g|ml|l)\b/);
  if (!m) return null;
  const n = (m[1] ? parseInt(m[1], 10) : 1) * parseFloat(m[2]);
  switch (m[3]) {
    case "kg": return { unit: "lb", amount: n * LB_PER_KG };
    case "lb": case "lbs": return { unit: "lb", amount: n };
    case "g": return { unit: "lb", amount: n / G_PER_LB };
    case "ml": return { unit: "L", amount: n / 1000 };
    case "l": return { unit: "L", amount: n };
  }
  return null;
}

// Turns flyer price text into a comparable figure: $/lb for anything sold by weight
// or with a weight on the pack, $/L for liquids, otherwise per item ("3/$5" -> $1.67 ea).
export function effectivePrice(item) {
  const d = item.details || {};
  const pre = (d.pre || "").toLowerCase();
  const post = (d.post || "").toLowerCase();
  const name = item.name.toLowerCase();
  let qty = 1;
  const multi = pre.match(/(\d+)\s*(\/|for)/);
  if (multi) qty = parseInt(multi[1], 10) || 1;
  let price = item.price / qty;
  if (/\/\s*lb|per\s*lb|^\s*lb\b/.test(post) || (!post && /per\s*lb/.test(name))) return { price, unit: "lb", qty, derived: false };
  if (/\/\s*kg|per\s*kg/.test(post)) return { price: price / LB_PER_KG, unit: "lb", qty, derived: true };
  if (/100\s*g/.test(post)) return { price: price * (G_PER_LB / 100), unit: "lb", qty, derived: true };
  const size = packSize(`${item.name} ${d.description || ""}`);
  if (size && size.amount > 0) return { price: price / size.amount, unit: size.unit, qty, derived: true, each: price };
  return { price, unit: "each", qty, derived: qty > 1 };
}

export function priceLabel(item) {
  const d = item.details || {};
  const pre = (d.pre || "").trim();
  const multi = /^\d+\s*\/$/.test(pre);
  const post = (d.post || "").trim().replace(/^(each|ea\.?)$/i, "ea");
  return { main: multi ? `${pre.replace(/\s/g, "")}$${fmt(item.price)}` : `$${fmt(item.price)}`, post };
}

export const fmt = (n) => n.toFixed(2);
export const UNIT_LABEL = { lb: "/lb", L: "/L", each: " ea" };

// Cheapest per comparable unit: by weight, by volume and per item are kept separate.
// `count` says how many results share that unit, so the UI can lead with the common one.
export function cheapest(results) {
  const best = {};
  for (const r of results) {
    const e = effectivePrice(r);
    const b = best[e.unit];
    if (!b) best[e.unit] = { item: r, eff: e, count: 1 };
    else { b.count++; if (e.price < b.eff.price) Object.assign(b, { item: r, eff: e }); }
  }
  return best;
}
