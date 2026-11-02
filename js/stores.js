// Store config and price-match rules.
// Policies checked Nov 2026. FreshCo's comes from freshco.com/legal, the rest from
// published guides. They change, so the UI always says "confirm in store".

export const STORES = {
  walmart: {
    name: "Walmart",
    color: "#0071dc",
    logo: "assets/logos/walmart.png",
    flipp: "walmart",
    flyerUrl: "https://www.walmart.ca/en/flyer",
    pm: "no",
    pmLabel: "walmart.ca only",
    pmNote: "Matches walmart.ca prices only. Its competitor Ad Match program ended in October 2020.",
  },
  costco: {
    name: "Costco",
    color: "#e31837",
    logo: "assets/logos/costco.png",
    flipp: "costco",
    flyerUrl: "https://www.costco.ca/warehouse-savings.html",
    pm: "no",
    pmLabel: "No",
    pmNote: "No competitor price matching. Membership required, and sizes are often bulk.",
    note: "Costco's flyer covers packaged and Kirkland deals, not fresh produce, meat or eggs.",
  },
  sobeys: {
    name: "Sobeys",
    color: "#1d7a46",
    logo: "assets/logos/sobeys.png",
    flipp: "sobeys",
    flyerUrl: "https://www.sobeys.com/flyer/",
    pm: "no",
    pmLabel: "No",
    pmNote: "No competitor price matching program.",
  },
  freshco: {
    name: "FreshCo",
    color: "#7cb518",
    logo: "assets/logos/freshco.png",
    flipp: "freshco",
    flyerUrl: "https://freshco.com/flyer/",
    pm: "yes",
    pmLabel: "Beats by 1¢",
    pmNote: "\"Lowest Price\" guarantee: beats an eligible discount competitor's flyer price by 1¢. In Ontario the eligible competitors are No Frills, Food Basics, Real Canadian Superstore and Walmart. Max 4 units per item.",
    matches: ["nofrills", "foodbasics", "walmart"],
  },
  chalofreshco: {
    name: "Chalo FreshCo",
    color: "#f08c00",
    logo: "assets/logos/chalofreshco.png",
    flipp: "chalofreshco",
    flyerUrl: "https://www.chalofreshco.com/flyer/",
    pm: "unknown",
    pmLabel: "Likely, ask",
    pmNote: "FreshCo's South Asian banner. No separate policy is published; it likely follows FreshCo's \"Lowest Price\" guarantee, so ask at your store.",
  },
  foodbasics: {
    name: "Food Basics",
    color: "#00843d",
    logo: "assets/logos/foodbasics.png",
    flipp: "foodbasics",
    flyerUrl: "https://www.foodbasics.ca/flyer",
    pm: "unknown",
    pmLabel: "Not published",
    pmNote: "No published competitor price-match policy. Ask your store. FreshCo and No Frills will match Food Basics' flyer.",
  },
  nofrills: {
    name: "No Frills",
    color: "#f5c400",
    logo: "assets/logos/nofrills.png",
    flipp: "nofrills",
    flyerUrl: "https://www.nofrills.ca/print-flyer",
    pm: "yes",
    pmLabel: "Matches",
    pmNote: "Matches flyer prices from major supermarket competitors in its local trade area. Limits can apply (often 4 per item).",
    matches: ["walmart", "freshco", "foodbasics"],
  },
  iqbal: {
    name: "Iqbal Foods",
    color: "#d7141a",
    logo: "assets/logos/iqbal.png",
    flipp: null,
    flyerUrl: "https://iqbalfoods.ca/shop?special_items=discount",
    pm: "no",
    pmLabel: "No",
    pmNote: "Independent halal grocer with no published price-match policy. Specials come from iqbalfoods.ca and refresh weekly.",
  },
};

export const STORE_KEYS = Object.keys(STORES);

// Stores that will match a flyer price from `storeKey`.
export function matchersFor(storeKey) {
  return STORE_KEYS.filter((k) => STORES[k].matches?.includes(storeKey));
}
