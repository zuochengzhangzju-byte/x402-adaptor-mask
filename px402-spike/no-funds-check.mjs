import {
  PrivacySDK,
  formatUSDCAmount,
  getChainConfig,
  logger,
  parsePaymentRequirements,
  parseUSDCAmount,
} from "@prxvt/sdk";

logger.setLevel?.("debug");

const chainsToCheck = ["base", "base-sepolia", "polygon", "polygon-amoy"];

const results = [];
for (const chain of chainsToCheck) {
  try {
    const sdk = new PrivacySDK({ chain });
    const config = getChainConfig(chain);
    results.push({
      chain,
      sdkConstructed: Boolean(sdk),
      config,
    });
  } catch (error) {
    results.push({
      chain,
      error: error.message,
    });
  }
}

const fakePaymentRequirement = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "2000",
      resource: "https://httpay.xyz/api/weather?lat=22.3193&lon=114.1694",
      description: "Weather forecast for any location via Open-Meteo (lat/lon)",
      mimeType: "application/json",
      payTo: "0x5f5d6FcB315871c26F720dc6fEf17052dD984359",
      maxTimeoutSeconds: 60,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
      },
    },
  ],
};

let parsedRequirement = null;
try {
  parsedRequirement = parsePaymentRequirements(fakePaymentRequirement);
} catch (error) {
  parsedRequirement = { error: error.message };
}

function stringify(value) {
  return JSON.stringify(value, (_key, item) => (
    typeof item === "bigint" ? item.toString() : item
  ), 2);
}

console.log(stringify({
  package: "@prxvt/sdk",
  checks: {
    allowedAmounts: PrivacySDK.ALLOWED_AMOUNTS,
    parseUSDCAmount_0_002: parseUSDCAmount("0.002"),
    formatUSDCAmount_2000: formatUSDCAmount("2000"),
    parsedRequirement,
    chains: results,
  },
  fundsTouched: false,
  depositCalled: false,
}));
