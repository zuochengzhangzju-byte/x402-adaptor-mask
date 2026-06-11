const query = process.argv.slice(2).join(" ") || process.env.BAZAAR_QUERY || "weather";
const network = process.env.BAZAAR_NETWORK || "";
const asset = process.env.BAZAAR_ASSET || "";
const maxUsdPrice = process.env.BAZAAR_MAX_USD_PRICE || "";

const params = new URLSearchParams({
  query,
  limit: "10",
});

if (network) {
  params.set("network", network);
}

if (asset) {
  params.set("asset", asset);
}

if (maxUsdPrice) {
  params.set("maxUsdPrice", maxUsdPrice);
}

const url = `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?${params}`;
const response = await fetch(url);

if (!response.ok) {
  throw new Error(`Bazaar search failed: ${response.status} ${await response.text()}`);
}

const body = await response.json();
const resources = body.resources || [];

console.log(JSON.stringify({
  query,
  network: network || "(any)",
  asset: asset || "(any)",
  maxUsdPrice: maxUsdPrice || "(any)",
  count: resources.length,
  resources: resources.map((resource) => ({
    resource: resource.resource,
    description: resource.description,
    accepts: resource.accepts,
    lastUpdated: resource.lastUpdated,
  })),
}, null, 2));
