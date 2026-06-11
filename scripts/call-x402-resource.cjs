require("dotenv").config();

const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base, baseSepolia, polygonAmoy } = require("viem/chains");
const { decodeXPaymentResponse, wrapFetchWithPayment } = require("x402-fetch");

const chains = {
  base,
  "base-sepolia": baseSepolia,
  "polygon-amoy": polygonAmoy,
};

const privateKey = process.env.PRIVATE_KEY;
const resourceUrl = process.env.RESOURCE_URL;
const chainName = process.env.X402_CHAIN || "base-sepolia";

if (!privateKey) {
  throw new Error("PRIVATE_KEY is missing. Copy .env.example to .env and set a disposable wallet key.");
}

if (!resourceUrl) {
  throw new Error("RESOURCE_URL is missing. Set it to a paid x402 endpoint URL.");
}

const chain = chains[chainName];
if (!chain) {
  throw new Error(`Unsupported X402_CHAIN: ${chainName}`);
}

const cleanedPrivateKey = privateKey
  .trim()
  .replace(/^['"]|['"]$/g, "")
  .replace(/\s+/g, "");

const normalizedPrivateKey = cleanedPrivateKey.startsWith("0x")
  ? cleanedPrivateKey
  : `0x${cleanedPrivateKey}`;

if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
  throw new Error(
    "PRIVATE_KEY must be a single 32-byte hex private key, with or without 0x prefix. Do not use a wallet address, mnemonic phrase, seed phrase, JSON keystore, or API key.",
  );
}

const account = privateKeyToAccount(normalizedPrivateKey);
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(),
});

const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient);

console.log(JSON.stringify({
  action: "x402_call_start",
  wallet: account.address,
  chain: chainName,
  resourceUrl,
}, null, 2));

(async () => {
  const startedAt = Date.now();
  const response = await fetchWithPayment(resourceUrl, { method: "GET" });
  const elapsedMs = Date.now() - startedAt;
  const contentType = response.headers.get("content-type") || "";
  const paymentHeader = response.headers.get("x-payment-response");

  let body;
  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  let decodedPayment = null;
  if (paymentHeader) {
    try {
      decodedPayment = decodeXPaymentResponse(paymentHeader);
    } catch (error) {
      try {
        decodedPayment = JSON.parse(paymentHeader);
      } catch {
        decodedPayment = { decodeError: error.message, raw: paymentHeader };
      }
    }
  }

  console.log(JSON.stringify({
    action: "x402_call_result",
    status: response.status,
    elapsedMs,
    decodedPayment,
    body,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
