import { PrivacySDK } from "@prxvt/sdk";

const sdk = new PrivacySDK({ chain: "base" });

sdk.setNote({
  version: "2.0",
  commitments: [
    {
      secret: "1",
      nullifier: "2",
      amount: 1,
      depositChain: "base",
    },
  ],
});

const privateFetch = sdk.wrapFetch(fetch);
const url = "https://httpay.xyz/api/weather?lat=22.3193&lon=114.1694";

try {
  const response = await privateFetch(url);
  console.log(JSON.stringify({
    unexpectedSuccess: true,
    status: response.status,
    body: await response.text(),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    expectedDryRunFailure: true,
    error: error.message,
    cause: error.cause ? {
      name: error.cause.name,
      code: error.cause.code,
      message: error.cause.message,
    } : undefined,
    fundsTouched: false,
    depositCalled: false,
    makePaymentReached: !error.message.includes("Insufficient balance") ? "unknown" : false,
  }, null, 2));
}
