# Privacy x402 Adapter Spec

## Scope

This document defines the boundary between an ordinary x402 buyer flow and a later privacy payment layer. It intentionally treats wallet implementation as an external dependency.

The adapter should focus on:

- x402 payment requirement parsing;
- shielded balance selection;
- unshield/private payment execution;
- payment proof forwarding;
- receipt and audit metadata;
- privacy-preserving defaults.

It should not implement a full wallet, custody system, exchange, KYC service, or LLM platform.

## Baseline x402 Flow

```text
agent/client
  -> resource server
  <- 402 Payment Required with payment requirements
agent/client
  -> creates payment payload from wallet
  -> retries request with payment header
resource server/facilitator
  -> verifies and settles payment
  -> returns resource and payment response
```

Important x402 concepts:

- payment requirements include scheme, network, asset, recipient, amount, timeout, resource, and optional facilitator details;
- EVM USDC flows commonly rely on signed authorizations such as EIP-3009, so a facilitator can submit settlement without a prior approval transaction;
- facilitators generally expose `verify` and `settle` APIs for resource servers;
- payment response/receipt headers are not fully uniform across all early providers.

## Adapter Placement

```text
agent/client
  -> x402 buyer
  -> privacy x402 adapter
  -> external shielded wallet / privacy rail
  -> x402 resource server
```

The adapter sits where a normal x402 client would ask a wallet to sign or fund the payment.

## Upstream Input

The x402 buyer passes a normalized payment requirement:

```json
{
  "resourceUrl": "https://example.com/api/weather?lat=22.3&lon=114.1",
  "scheme": "exact",
  "network": "base",
  "chainId": 8453,
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "assetSymbol": "USDC",
  "amountAtomic": "2000",
  "payTo": "0x...",
  "maxTimeoutSeconds": 60,
  "headersRequired": ["X-PAYMENT"],
  "facilitator": "https://x402.org/facilitator"
}
```

The adapter should also receive local policy:

```json
{
  "agentId": "weather-agent",
  "maxAtomicPerCall": "10000",
  "monthlyBudgetAtomic": "20000000",
  "allowedNetworks": ["base"],
  "allowedAssets": ["USDC"],
  "allowedMerchants": ["0x..."],
  "allowUnshieldToPublicPayTo": true,
  "requireHumanApproval": false
}
```

## Downstream Wallet Interface

The adapter should call an external wallet/privacy rail through a small abstract interface:

```ts
interface ShieldedPaymentRail {
  getBalance(params: {
    network: string;
    asset: string;
  }): Promise<{ amountAtomic: string }>;

  payPublicRecipient(params: {
    network: string;
    asset: string;
    amountAtomic: string;
    payTo: string;
    memo?: string;
    privacyHint?: "unshield" | "stealth" | "private-transfer";
  }): Promise<{
    status: "submitted" | "settled" | "failed";
    txHash?: string;
    paymentId?: string;
    publicPayer?: string;
    receipt?: unknown;
  }>;
}
```

For Curvy/crops.cash, this maps roughly to:

```text
onboard
balance
send / unshield required USDC to x402 payment address
```

For Railgun, this maps roughly to:

```text
shield public funds into 0zk balance
generate proof
unshield to public x402 payTo address, ideally through relayer/broadcaster
```

## Two Possible Payment Strategies

### Strategy A: Unshield-to-pay

```text
shielded balance
  -> unshield exact amount to x402 payTo
  -> resource server/facilitator observes ordinary payment settlement
```

Pros:

- easiest to layer onto existing x402 resources;
- resource server does not need to understand privacy protocols;
- aligns with crops.cash's described flow.

Cons:

- may not produce a standard x402 signed authorization header by itself;
- timing and amount still reveal a purchase event;
- if the endpoint requires EIP-3009-style authorization from the payer, a direct unshield transaction may not satisfy the provider unless the provider accepts tx-based receipts.

### Strategy B: Private funding of disposable payer

```text
shielded balance
  -> unshield budget to fresh disposable 0x payer
  -> disposable payer creates normal x402 payment authorization
```

Pros:

- maximally compatible with existing x402 SDKs and facilitators;
- clean separation between privacy funding and x402 payment mechanics;
- easy to debug.

Cons:

- disposable payer becomes linkable for all calls until rotated;
- requires balance management and rotation;
- privacy depends on avoiding reuse and obvious timing/amount patterns.

## Recommended MVP Privacy Insertion

Start with Strategy B:

```text
Curvy/Railgun shielded balance
  -> periodically fund a fresh small x402 hot wallet
  -> ordinary x402 buyer pays resources
  -> rotate wallet when budget or time window expires
```

This keeps x402 compatibility high while providing wallet/payment unlinkability from the user's main wallet.

Only later attempt Strategy A, where the privacy rail directly satisfies the x402 payment challenge.

See `SHIELDED_WALLET_PREP_GUIDE.md` for the human setup checklist.

## Receipts

The adapter should record:

```json
{
  "agentId": "weather-agent",
  "resourceUrlHash": "sha256:...",
  "paymentRequirementHash": "sha256:...",
  "network": "base",
  "asset": "USDC",
  "amountAtomic": "2000",
  "payTo": "0x...",
  "privacyStrategy": "disposable-payer",
  "privacyRail": "curvy|railgun|none",
  "fundingTxHash": "0x...",
  "x402TxHash": "0x...",
  "responseHash": "sha256:...",
  "status": "settled"
}
```

Avoid storing raw sensitive resource URLs if they contain PII. Store hashes and a redacted display string.

## Open Questions

- Can a privacy rail directly produce an x402-compatible `X-PAYMENT` authorization, or is a disposable payer required?
- Which providers accept already-settled tx receipts versus strict `X-PAYMENT` / `PAYMENT-SIGNATURE` headers?
- How should idempotency be handled if payment succeeds but resource delivery fails?
- What metadata in x402 payment requirements can leak PII through resource URLs or descriptions?
- What rotation schedule gives a useful privacy improvement without breaking marketplace trust/reputation?
