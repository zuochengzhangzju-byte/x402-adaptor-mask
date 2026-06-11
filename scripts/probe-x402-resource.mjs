#!/usr/bin/env node
const args = parseArgs(process.argv.slice(2));

const url = args.url;
if (!url) {
  throw new Error("--url is required.");
}

const method = String(args.method || "GET").toUpperCase();
const headers = {};
let body;
if (args.bodyFile) {
  headers["content-type"] = "application/json";
  body = await fsReadText(args.bodyFile);
} else if (args.body) {
  headers["content-type"] = "application/json";
  body = args.body;
}

const startedAt = Date.now();
const response = await fetch(url, { method, headers, body });
const elapsedMs = Date.now() - startedAt;
const text = await response.text();

const paymentRequiredHeader = response.headers.get("payment-required");
const x402Header = response.headers.get("x-402-payment-required")
  || response.headers.get("x-payment-required");
const contentType = response.headers.get("content-type") || "";
let parsedBody = parseJson(text);
let decodedPaymentRequired = null;

if (paymentRequiredHeader) {
  decodedPaymentRequired = parseJson(Buffer.from(paymentRequiredHeader, "base64").toString("utf8"));
}

const challenge = decodedPaymentRequired || parsedBody || {};
const accepts = Array.isArray(challenge.accepts) ? challenge.accepts : [];

console.log(JSON.stringify({
  action: "probe_x402_resource",
  request: {
    url,
    method,
    hasBody: Boolean(body),
  },
  response: {
    status: response.status,
    elapsedMs,
    contentType,
    headers: {
      paymentRequired: Boolean(paymentRequiredHeader),
      x402PaymentRequired: Boolean(x402Header),
    },
    body: parsedBody ?? text.slice(0, 1000),
  },
  x402: {
    challengeFound: Boolean(decodedPaymentRequired || accepts.length),
    decodedPaymentRequired,
    accepts: accepts.map((item) => ({
      scheme: item.scheme,
      network: item.network,
      asset: item.asset,
      amount: item.amount || item.maxAmountRequired,
      priceUsdc: Number(item.amount || item.maxAmountRequired || 0) / 1_000_000,
      payTo: item.payTo,
      mimeType: item.mimeType,
      maxTimeoutSeconds: item.maxTimeoutSeconds,
      resource: item.resource,
      description: item.description,
    })),
  },
}, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const [rawKey, rawValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (rawValue !== undefined) {
      out[key] = rawValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[i + 1];
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fsReadText(file) {
  const fs = await import("node:fs/promises");
  return fs.readFile(file, "utf8");
}
