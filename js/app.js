import { STORES, STORE_KEYS, matchersFor } from "./stores.js";
import {
  loadFlyers, loadFlyerItems, loadDetails, searchDetails, loadIqbal, search, verdictPool, effectivePrice,
  priceLabel, cheapest, fmt, UNIT_LABEL, cleanPostal, validPostal, isFuture,
} from "./core.js";

const DEFAULT_POSTAL = "M5B2K3"; // downtown Toronto
const QUICK = ["Roma tomatoes", "Bananas", "Eggs", "Milk", "Chicken thighs", "Ground beef", "Onions", "Basmati rice", "Butter", "Avocados"];
const PER_STORE = 3;      // items shown per store before "show more"
const PER_STORE_MAX = 8;  // items we fetch details for

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const state = {
  postal: cleanPostal(store.get("ff:postal")) || DEFAULT_POSTAL,
  enabled: new Set(JSON.parse(store.get("ff:stores") || "null") || STORE_KEYS),
  flyers: [],
  items: [],
  iqbal: null,
  ready: false,
  errors: [],
  query: "",
  searchId: 0,
  details: new Map(),   // Flipp item id -> unit/sale details, kept across searches
  expanded: new Set(),  // store cards opened with "show more"
  deals: { store: STORE_KEYS.includes(store.get("ff:dealsStore")) ? store.get("ff:dealsStore") : "costco", filter: "", sort: "featured", limit: 48, token: 0 },
};

// ── Data ────────────────────────────────────────────────────────────
async function loadAll() {
  state.ready = false;
  state.errors = [];
  setStatus(`<span class="pulse-dot"></span>Loading flyers near ${fmtPostal(state.postal)}…`);
  const [flyers, iqbal] = await Promise.all([
    loadFlyers(state.postal).catch((e) => { state.errors.push("Flipp flyers"); console.error(e); return []; }),
    loadIqbal().catch((e) => { state.errors.push("Iqbal specials"); console.error(e); return null; }),
  ]);
  state.flyers = flyers;
  state.iqbal = iqbal;
  let done = 0;
  const lists = await Promise.all(flyers.map((f) =>
    loadFlyerItems(f)
      .then((items) => { f.count = items.length; return items; })
      .catch((e) => { f.count = 0; state.errors.push(`${STORES[f.store].name} flyer`); console.error(e); return []; })
      .finally(() => setStatus(`<span class="pulse-dot"></span>Reading flyers… ${++done}/${flyers.length}`))
  ));
  state.items = lists.flat().concat(iqbal?.items || []);
  state.ready = true;
  renderStatus();
  renderFlyers();
  renderWeek();
  if ($("#tab-deals").classList.contains("active")) renderDeals(); else renderDealsPicker();
  if (state.query) runSearch(state.query);
}

async function pool(tasks, n = 6) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) { const j = i++; out[j] = await tasks[j](); }
  }));
  return out;
}

// ── Search ──────────────────────────────────────────────────────────
async function runSearch(q) {
  q = q.trim();
  state.query = q;
  $("#q").value = q;
  history.replaceState(null, "", q ? `#q=${encodeURIComponent(q)}` : location.pathname);
  if (!q) return renderIntro();
  if (!state.ready) return renderSkeleton(q);

  const id = ++state.searchId;
  const candidates = state.items.filter((i) => state.enabled.has(i.store));
  const results = search(candidates, q);

  // Group by store (results arrive sorted by tier); "closest" matches only fill in
  // for stores with no real hit.
  const byStore = {};
  for (const k of STORE_KEYS) {
    if (!state.enabled.has(k)) continue;
    const rs = results.filter((r) => r.store === k);
    const exact = rs.filter((r) => r.kind === "exact");
    byStore[k] = (exact.length ? exact : rs.filter((r) => !r.processed).concat(rs.filter((r) => r.processed))).slice(0, PER_STORE_MAX);
  }
  const shown = Object.values(byStore).flat();
  state.expanded.clear();

  // Unit text ("/lb", "3/") needs details. One Flipp search call covers most items;
  // the rest are fetched individually. Results show after at most ~350ms either way,
  // using pack sizes from item names, then refresh once the details are in.
  const missing = () => shown.filter((r) => r.source === "flipp" && !attachDetails(r));
  const fetchDetails = (async () => {
    if (!missing().length) return;
    try {
      for (const [k, d] of await searchDetails(q, state.postal)) if (!state.details.has(k)) state.details.set(k, d);
    } catch { /* fall back to per-item calls */ }
    await pool(missing().map((r) => async () => {
      try { state.details.set(r.id, await loadDetails(r.id)); } catch { state.details.set(r.id, {}); }
    }), 10);
  })();
  const inTime = await Promise.race([fetchDetails.then(() => true), new Promise((r) => setTimeout(r, 350, false))]);
  if (id !== state.searchId) return; // a newer search started meanwhile
  missing();
  renderResults(q, byStore);
  if (inTime) return;
  await fetchDetails;
  if (id !== state.searchId) return;
  missing();
  renderResults(q, byStore);
}

function attachDetails(r) {
  const d = r.details || state.details.get(r.id);
  if (d) r.details = d;
  return !!d;
}

// ── Rendering ───────────────────────────────────────────────────────
function setStatus(html) { $("#status").innerHTML = html; }

function renderStatus() {
  const n = state.items.filter((i) => state.enabled.has(i.store)).length;
  const parts = [`${state.flyers.length} flyers`, `${n.toLocaleString()} items`, `near ${fmtPostal(state.postal)}`];
  if (state.iqbal && !iqbalStale()) parts.push(`Iqbal updated ${fmtDate(state.iqbal.updated)}`);
  const missing = STORE_KEYS.filter((k) => STORES[k].flipp && !state.flyers.some((f) => f.store === k));
  const soon = STORE_KEYS.filter((k) => state.flyers.some((f) => f.store === k) && state.flyers.filter((f) => f.store === k).every((f) => f.upcoming));
  let html = `<span class="pulse-dot"></span>${parts.join(" · ")}`;
  if (soon.length) html += ` <span class="warn">· showing next week's flyer: ${soon.map((k) => `${STORES[k].name} (starts ${fmtDate(state.flyers.find((f) => f.store === k).from)})`).join(", ")}</span>`;
  if (missing.length) html += ` <span class="warn">· no current flyer: ${missing.map((k) => STORES[k].name).join(", ")}</span>`;
  if (iqbalStale()) html += ` <span class="warn">· Iqbal specials are ${iqbalAgeDays()} days old and may be outdated</span>`;
  if (state.errors.length) html += ` <span class="err">· couldn't load ${esc(state.errors.join(", "))}</span>`;
  setStatus(html);
}

function renderWeek() {
  // Most flyers share one Thu–Wed week; use the most common range (Costco and others run off-cycle).
  const counts = {};
  for (const f of state.flyers.filter((f) => !f.upcoming)) { const k = `${fmtDate(f.from)} – ${fmtDate(f.to)}`; counts[k] = (counts[k] || 0) + 1; }
  const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $("#weekRange").textContent = common ? `· ${common[0]}` : "";
}

function renderSkeleton(q) {
  $("#results").innerHTML = `
    <div class="results-head"><h2>Searching for <em>${esc(q)}</em>…</h2></div>
    <div class="store-grid">${"<div class='skeleton'></div>".repeat(6)}</div>`;
}

function renderIntro() {
  $("#results").innerHTML = `
    <div class="intro-grid">
      <div class="intro-card"><div class="k">01 · Search</div><p>Type any grocery item. Every store's current flyer is searched at once.</p></div>
      <div class="intro-card"><div class="k">02 · Compare</div><p>Prices are converted to $/lb or $/L where the size is known, so a 3 lb bag and a 10 lb bag compare fairly.</p></div>
      <div class="intro-card"><div class="k">03 · Price match</div><p>See which stores will match the cheapest flyer, so you can do one shop instead of five.</p></div>
      <div class="intro-card"><div class="k">04 · Check the flyer</div><p>Each result shows the item clipped from the actual flyer. Tap it to zoom.</p></div>
    </div>`;
}

const storeDot = (k) => `<span class="dot" style="background:${STORES[k].color};color:${STORES[k].color}"></span>`;
const pmBadge = (k) => `<span class="badge ${STORES[k].pm}" title="${esc(STORES[k].pmNote)}">${STORES[k].pm === "yes" ? "✓ " : ""}PM: ${esc(STORES[k].pmLabel)}</span>`;
const UNIT_NAME = { lb: "by weight", L: "by volume", each: "per item" };

function renderResults(q, byStore) {
  const all = Object.values(byStore).flat();
  if (!all.length) {
    $("#results").innerHTML = `
      <div class="results-head"><h2>No flyer deals for <em>${esc(q)}</em> this week</h2></div>
      <p class="caption">Try a simpler word ("tomatoes" instead of "roma tomatoes"), or check back Thursday when most flyers change.</p>`;
    return;
  }
  // Cheapest is judged on the most relevant tier only; lead with the unit most results use.
  const judged = verdictPool(all);
  const best = cheapest(judged);
  const units = Object.keys(best).sort((a, b) => best[b].count - best[a].count).slice(0, 2);
  const bestIds = new Set(units.map((u) => best[u].item.id));
  const exactCount = all.filter((r) => r.kind === "exact").length;

  const verdicts = units.map((u) => verdictCard(u, best[u], judged)).join("");

  // Order stores by their cheapest item in the headline unit; empty stores last.
  const lead = units[0];
  const storeBest = (k) => {
    const rs = byStore[k].map((r) => effectivePrice(r)).filter((e) => e.unit === lead);
    return rs.length ? Math.min(...rs.map((e) => e.price)) : byStore[k].length ? 1e6 : 1e9;
  };
  const order = Object.keys(byStore).sort((a, b) => storeBest(a) - storeBest(b));

  $("#results").innerHTML = `
    <div class="results-head">
      <h2>${exactCount ? `Results for <em>${esc(q)}</em>` : `No exact <em>${esc(q)}</em> this week. Closest matches:`}</h2>
      <span class="meta">${exactCount} matches · ${order.filter((k) => byStore[k].length).length} of ${order.length} stores</span>
    </div>
    <div class="verdicts">${verdicts}</div>
    <div class="store-grid">${order.map((k) => storeCard(k, byStore[k], bestIds)).join("")}</div>
    <p class="note">≈ prices are worked out from the pack size printed in the flyer. Check the flyer clipping for exact sizes and conditions.</p>`;
}

function verdictCard(unit, { item, eff }, pool_) {
  const s = STORES[item.store];
  // Savings vs the priciest comparable option elsewhere. Per-item prices of different
  // products don't compare, so only weight and volume get a savings line.
  // Closest-match verdicts skip it too: they'd compare tomatoes against tomato chips.
  const others = unit === "each" || item.tier === 3 ? [] : pool_.filter((r) => r.store !== item.store).map((r) => ({ r, e: effectivePrice(r) })).filter((x) => x.e.unit === unit);
  const worst = others.sort((a, b) => b.e.price - a.e.price)[0];
  const save = worst && worst.e.price > eff.price
    ? `<div class="verdict-save">Saves ${pct(eff.price, worst.e.price)} vs ${esc(STORES[worst.r.store].name)} ($${fmt(worst.e.price)}${UNIT_LABEL[unit]})</div>` : "";
  return `
    <article class="verdict">
      ${thumb(item, true)}
      <div>
        <div class="verdict-label">Cheapest ${UNIT_NAME[unit]}</div>
        <div class="verdict-price">$${fmt(eff.price)}<small>${UNIT_LABEL[unit]}</small></div>
        <div class="verdict-store">${storeDot(item.store)}${esc(s.name)}</div>
        <div class="verdict-item">${esc(item.name)}</div>
        ${save}
      </div>
      ${pmTip(item)}
    </article>`;
}

function pmTip(item) {
  const k = item.store;
  const matchers = matchersFor(k).filter((m) => state.enabled.has(m));
  if (STORES[k].pm === "yes") {
    return `<div class="pm-tip"><span class="ico">✓</span><span>Already cheapest at <b>${esc(STORES[k].name)}</b>, which also price matches, so you can grab the rest of your list there too.</span></div>`;
  }
  if (matchers.length) {
    const names = matchers.map((m) => `<b>${esc(STORES[m].name)}</b>`).join(" or ");
    const fc = matchers.includes("freshco") ? " (FreshCo beats it by 1¢)" : "";
    return `<div class="pm-tip"><span class="ico">⇄</span><span>Shopping at ${names}? Show this ${esc(STORES[k].name)} flyer price and they'll match it${fc}.</span></div>`;
  }
  return `<div class="pm-tip"><span class="ico">!</span><span>FreshCo and No Frills don't usually match ${esc(STORES[k].name)}, so buy this one at ${esc(STORES[k].name)}.</span></div>`;
}

function storeCard(k, items, bestIds) {
  const s = STORES[k];
  const head = `
    <div class="store-head">${storeDot(k)}<span class="name">${esc(s.name)}</span>${pmBadge(k)}
      ${items.length ? `<span class="best">from $${fmt(Math.min(...items.map((r) => effectivePrice(r).price)))}</span>` : ""}
    </div>`;
  if (!items.length) {
    const hasFlyer = !s.flipp || state.flyers.some((f) => f.store === k);
    let msg = hasFlyer ? "Not in this week's flyer." : `No current flyer near ${fmtPostal(state.postal)}.`;
    if (s.note) msg += ` ${s.note}`;
    return `<article class="store-card empty" style="--store:${s.color}">${head}<div class="empty-msg">${esc(msg)}</div></article>`;
  }
  const open = state.expanded.has(k);
  const rows = items.map((r, i) => itemRow(r, bestIds.has(r.id), !open && i >= PER_STORE)).join("");
  const more = !open && items.length > PER_STORE ? `<button class="more-btn" data-more="${k}">Show ${items.length - PER_STORE} more</button>` : "";
  return `<article class="store-card" style="--store:${s.color}">${head}<ul class="items">${rows}</ul>${more}</article>`;
}

function itemRow(r, isBest, hidden) {
  const d = r.details || {};
  const lbl = priceLabel(r);
  const eff = effectivePrice(r);
  const effLine = eff.derived ? `<span class="eff">≈ $${fmt(eff.price)}${UNIT_LABEL[eff.unit]}</span>` : "";
  const was = d.original && d.original > r.price ? `<span class="was">$${fmt(d.original)}</span>` : "";
  const tags = [
    isBest ? `<span class="tag best">Cheapest</span>` : "",
    r.kind === "related" ? `<span class="tag close">Closest match</span>` : "",
    soonTag(r),
    d.sale && r.source === "flipp" ? `<span class="tag sale">${esc(d.sale)}</span>` : "",
  ].join("");
  const when = whenLabel(r);
  const name = d.link ? `<a href="${esc(d.link)}" target="_blank" rel="noopener" style="color:inherit">${esc(r.name)}</a>` : esc(r.name);
  return `
    <li class="item${isBest ? " is-best" : ""}"${hidden ? " hidden" : ""}>
      ${thumb(r)}
      <div>
        <div class="item-name">${name}</div>
        <div class="item-meta">${tags}<span>${when}</span></div>
      </div>
      <div class="item-price">${was}<span class="p">${esc(lbl.main)}</span><span class="u">${esc(lbl.post)}</span>${effLine}</div>
    </li>`;
}

function thumb(r) {
  if (!r.image) return `<div class="thumb noimg">no image</div>`;
  const cap = `<b>${esc(r.name)}</b> · ${esc(STORES[r.store].name)} · ${esc(priceLabel(r).main)}${esc(priceLabel(r).post)}`;
  return `<button class="thumb" data-zoom="${esc(r.image)}" data-cap="${esc(cap)}" aria-label="View flyer clipping"><img loading="lazy" src="${esc(r.image)}" alt="${esc(r.name)}" onerror="this.parentElement.classList.add('noimg');this.remove()"></button>`;
}

// ── Store deals tab ─────────────────────────────────────────────────
const DEALS_PAGE = 48;
const DEAL_SORTS = { featured: "Flyer order", low: "Price: low to high", high: "Price: high to low", az: "Name: A–Z" };

function storeItems(k) {
  const seen = new Set();
  return state.items.filter((i) => {
    if (i.store !== k) return false;
    const key = `${i.name.toLowerCase()}|${i.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderDealsPicker() {
  $("#dealsPicker").innerHTML = STORE_KEYS.map((k) => {
    const n = state.ready ? storeItems(k).length : "…";
    return `<button class="deal-store${k === state.deals.store ? " active" : ""}" data-deals="${k}" style="--store:${STORES[k].color}">${storeDot(k)}${esc(STORES[k].name)}<span class="count">${n}</span></button>`;
  }).join("");
}

function renderDeals() {
  renderDealsPicker();
  const k = state.deals.store;
  const s = STORES[k];
  if (!state.ready) {
    $("#dealsBody").innerHTML = `<div class="deal-grid">${"<div class='skeleton deal-skel'></div>".repeat(8)}</div>`;
    return;
  }
  const fs = state.flyers.filter((f) => f.store === k);
  const when = k === "iqbal"
    ? (state.iqbal ? `Weekly specials · updated ${fmtDate(state.iqbal.updated)}${iqbalStale() ? " (may be outdated)" : ""}` : "")
    : fs.map((f) => `${f.upcoming ? "Next flyer: " : ""}${fmtDate(f.from)} – ${fmtDate(f.to)}`).filter((v, i, a) => a.indexOf(v) === i).join(" · ");

  const words = state.deals.filter.toLowerCase().split(/\s+/).filter(Boolean);
  let items = storeItems(k).filter((i) => words.every((w) => i.name.toLowerCase().includes(w)));
  if (state.deals.sort === "low") items.sort((a, b) => a.price - b.price);
  else if (state.deals.sort === "high") items.sort((a, b) => b.price - a.price);
  else if (state.deals.sort === "az") items.sort((a, b) => a.name.localeCompare(b.name));
  const page = items.slice(0, state.deals.limit);

  const head = `
    <div class="deals-head">
      <div>
        <div class="deals-title">${storeDot(k)}${esc(s.name)} ${pmBadge(k)}</div>
        <div class="deals-sub">${esc(when) || "No current flyer for this postal code"} · ${items.length} deal${items.length === 1 ? "" : "s"}${words.length ? " matching" : ""}</div>
      </div>
      <div class="deals-tools">
        <input id="dealsFilter" type="search" placeholder="Filter ${esc(s.name)} deals…" value="${esc(state.deals.filter)}" aria-label="Filter deals">
        <select id="dealsSort" aria-label="Sort deals">${Object.entries(DEAL_SORTS).map(([v, l]) => `<option value="${v}"${v === state.deals.sort ? " selected" : ""}>${l}</option>`).join("")}</select>
        <a class="home-nav-btn small" href="${s.flyerUrl}" target="_blank" rel="noopener">Official flyer →</a>
      </div>
    </div>`;

  let body;
  if (!items.length) {
    body = `<div class="empty-msg">${words.length ? "Nothing in this flyer matches that filter." : `No deals loaded for ${esc(s.name)} this week.${s.note ? " " + esc(s.note) : ""}`}</div>`;
  } else {
    const more = items.length > page.length ? `<button class="home-nav-btn deals-more" data-deals-more>Show ${Math.min(DEALS_PAGE, items.length - page.length)} more (${items.length - page.length} left)</button>` : "";
    body = `<div class="deal-grid">${page.map(dealCard).join("")}</div>${more}`;
  }
  // Keep focus in the filter box while typing
  const focused = document.activeElement?.id === "dealsFilter";
  const caret = focused ? document.activeElement.selectionStart : 0;
  $("#dealsBody").innerHTML = head + body;
  if (focused) { const f = $("#dealsFilter"); f.focus(); f.setSelectionRange(caret, caret); }
  hydrateDeals(page);
}

function dealCard(r) {
  attachDetails(r);
  return `<article class="deal-card" data-deal="${r.id}">${thumb(r)}<div class="deal-body">${dealInfo(r)}</div></article>`;
}

function dealInfo(r) {
  const d = r.details || {};
  const lbl = priceLabel(r);
  const eff = effectivePrice(r);
  const was = d.original && d.original > r.price ? `<span class="was">$${fmt(d.original)}</span>` : "";
  const sale = d.sale && r.source === "flipp" ? `<span class="tag sale">${esc(d.sale)}</span>` : "";
  const effLine = eff.derived ? `<span class="eff">≈ $${fmt(eff.price)}${UNIT_LABEL[eff.unit]}</span>` : "";
  return `
    <div class="deal-price">${was}<span class="p">${esc(lbl.main)}</span><span class="u${lbl.post.length > 6 ? " long" : ""}">${esc(lbl.post)}</span>${effLine}</div>
    <div class="deal-name">${esc(r.name)}</div>
    <div class="item-meta">${soonTag(r)}${sale}<span>${whenLabel(r)}</span></div>`;
}

// Units and sale copy load for the cards on screen and fill in place.
async function hydrateDeals(page) {
  const token = ++state.deals.token;
  const need = page.filter((r) => r.source === "flipp" && !attachDetails(r));
  await pool(need.map((r) => async () => {
    if (token !== state.deals.token) return;
    try { state.details.set(r.id, await loadDetails(r.id)); } catch { state.details.set(r.id, {}); }
    attachDetails(r);
    const el = document.querySelector(`[data-deal="${r.id}"] .deal-body`);
    if (el && token === state.deals.token) el.innerHTML = dealInfo(r);
  }), 10);
}

function openDeals(k) {
  if (k && STORES[k]) {
    state.deals.store = k;
    state.deals.filter = "";
    state.deals.limit = DEALS_PAGE;
    store.set("ff:dealsStore", k);
  }
  showTab("deals");
  history.replaceState(null, "", `#deals=${state.deals.store}`);
  renderDeals();
}

function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

// ── Other tabs ──────────────────────────────────────────────────────
function renderPM() {
  $("#pmGrid").innerHTML = STORE_KEYS.map((k) => `
    <article class="pm-card" style="--store:${STORES[k].color}">
      <div class="pm-card-head">${storeDot(k)}<span class="name">${esc(STORES[k].name)}</span>${pmBadge(k)}</div>
      <p>${esc(STORES[k].pmNote)}</p>
    </article>`).join("");
  const matchers = STORE_KEYS.filter((k) => STORES[k].matches);
  const others = STORE_KEYS;
  $("#pmTable").innerHTML = `
    <thead><tr><th>Shop at ↓ / Flyer from →</th>${others.map((o) => `<th>${esc(STORES[o].name)}</th>`).join("")}</tr></thead>
    <tbody>${matchers.map((m) => `<tr><td>${storeDot(m)} ${esc(STORES[m].name)}</td>${others.map((o) =>
      o === m ? `<td class="n">·</td>` : STORES[m].matches.includes(o) ? `<td class="y">✓</td>` : `<td class="n">✕</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function renderFlyers() {
  $("#flyerCaption").textContent = `Current flyers near ${fmtPostal(state.postal)}. Most change every Thursday. Change your postal code in the top bar.`;
  $("#flyerGrid").innerHTML = STORE_KEYS.map((k) => {
    const s = STORES[k];
    let body;
    if (k === "iqbal") {
      body = state.iqbal
        ? `<div class="row">${state.iqbal.items.length} weekly specials</div><div class="row">Updated ${fmtDate(state.iqbal.updated)}</div>${iqbalStale() ? `<div class="missing">${iqbalAgeDays()} days old. The weekly update may have stopped.</div>` : ""}`
        : `<div class="missing">Specials file couldn't be loaded.</div>`;
    } else {
      const fs = state.flyers.filter((f) => f.store === k);
      body = fs.length
        ? fs.map((f) => `<div class="row">${f.upcoming ? `<span class="soon-text">Next flyer, starts ${fmtDate(f.from)}</span><br>` : ""}${fmtDate(f.from)} – ${fmtDate(f.to)} · ${f.count ?? "…"} items</div>`).join("")
        : `<div class="missing">No current flyer for this postal code.</div>`;
    }
    return `<article class="flyer-card" style="--store:${s.color}"><div class="name">${storeDot(k)}${esc(s.name)}</div>${body}<div class="flyer-links"><button class="home-nav-btn small" data-deals="${k}">View all deals</button><a href="${s.flyerUrl}" target="_blank" rel="noopener">Official flyer →</a></div></article>`;
  }).join("");
}

function renderControls() {
  $("#quick").innerHTML = QUICK.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("");
  $("#storeToggles").innerHTML = STORE_KEYS.map((k) =>
    `<button class="store-toggle${state.enabled.has(k) ? "" : " off"}" data-store="${k}" aria-pressed="${state.enabled.has(k)}">${storeDot(k)}${esc(STORES[k].name)}</button>`).join("");
}

// ── Freshness ───────────────────────────────────────────────────────
const STALE_DAYS = 10; // Iqbal refreshes weekly; past this the GitHub Action has likely stopped

function iqbalAgeDays() { return state.iqbal ? Math.floor((Date.now() - new Date(state.iqbal.updated)) / 86400000) : 0; }
function iqbalStale() { return iqbalAgeDays() > STALE_DAYS; }

function whenLabel(r) {
  if (isFuture(r.startsAt)) return `Starts ${fmtDate(r.startsAt)}`;
  if (r.validTo) return `Until ${fmtDate(r.validTo)}`;
  if (r.source === "iqbal") return iqbalStale() ? `From ${fmtDate(state.iqbal.updated)}, may be outdated` : "Weekly special";
  return "";
}
const soonTag = (r) => (isFuture(r.startsAt) ? `<span class="tag soon">Next flyer</span>` : "");

// ── Helpers ─────────────────────────────────────────────────────────
function fmtDate(d) { return new Date(d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }); }
function fmtPostal(p) { return p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p; }
function pct(a, b) { return `${Math.round((1 - a / b) * 100)}%`; }

// ── Events ──────────────────────────────────────────────────────────
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("#q").value); });

$("#postalForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#postal");
  const p = cleanPostal(input.value);
  if (!validPostal(p)) { input.classList.add("bad"); input.focus(); return; }
  input.classList.remove("bad");
  input.value = fmtPostal(p);
  if (p === state.postal) return;
  state.postal = p;
  store.set("ff:postal", p);
  loadAll();
});

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-q]");
  if (chip) return runSearch(chip.dataset.q);

  const tog = e.target.closest("[data-store]");
  if (tog) {
    const k = tog.dataset.store;
    state.enabled.has(k) ? state.enabled.delete(k) : state.enabled.add(k);
    if (!state.enabled.size) state.enabled.add(k);
    store.set("ff:stores", JSON.stringify([...state.enabled]));
    renderControls();
    if (state.ready) renderStatus();
    if (state.query) runSearch(state.query);
    return;
  }

  const more = e.target.closest("[data-more]");
  if (more) {
    state.expanded.add(more.dataset.more);
    more.closest(".store-card").querySelectorAll(".item[hidden]").forEach((li) => (li.hidden = false));
    return more.remove();
  }

  const z = e.target.closest("[data-zoom]");
  if (z) {
    $("#lightboxImg").src = z.dataset.zoom;
    $("#lightboxCap").innerHTML = z.dataset.cap;
    $("#lightbox").hidden = false;
    return;
  }
  if (e.target.closest("#lightbox")) $("#lightbox").hidden = true;

  const pick = e.target.closest("[data-deals]");
  if (pick) return openDeals(pick.dataset.deals);

  if (e.target.closest("[data-deals-more]")) {
    state.deals.limit += DEALS_PAGE;
    return renderDeals();
  }

  const tab = e.target.closest(".tab-btn");
  if (tab) {
    const name = tab.dataset.tab;
    if (name === "deals") return openDeals();
    showTab(name);
    history.replaceState(null, "", name === "compare" && state.query ? `#q=${encodeURIComponent(state.query)}` : location.pathname);
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });

// ── Boot ────────────────────────────────────────────────────────────
$("#postal").value = fmtPostal(state.postal);
$("#storeCount").textContent = STORE_KEYS.length;
renderControls();
renderPM();
renderFlyers();
let filterTimer;
document.addEventListener("input", (e) => {
  if (e.target.id !== "dealsFilter") return;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { state.deals.filter = e.target.value; state.deals.limit = DEALS_PAGE; renderDeals(); }, 150);
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "dealsSort") return;
  state.deals.sort = e.target.value;
  state.deals.limit = DEALS_PAGE;
  renderDeals();
});

const hash = new URLSearchParams(location.hash.slice(1));
const initial = hash.get("q");
if (initial) { state.query = initial; $("#q").value = initial; renderSkeleton(initial); } else renderIntro();
if (hash.has("deals")) openDeals(hash.get("deals")); else renderDealsPicker();
loadAll();
