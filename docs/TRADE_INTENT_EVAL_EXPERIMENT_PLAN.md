# Trade-Intent Evaluation Experiment Plan

This plan turns the current demo evidence into a repeatable evaluation for:

1. tool-call speed;
2. paid-but-failed edge cases;
3. raw x402 and direct API baselines;
4. a stronger trade-intent paid-service example.

The current validated cases are:

- CoinMarketCap x402 market data: `0.01 USDC`, successful HTTP 200.
- Exa x402 search: `0.007 USDC`, successful HTTP 200.

Those two cases are enough for a demo table about evidence recording and output validation. They are not enough for latency distribution or incident-rate claims.

## What To Measure

Every run should write one JSONL row. Use one `runId` across all artifacts.

```json
{
  "runId": "20260610T143000Z-adapter-cmc-001",
  "mode": "adapter|raw_x402|direct_api",
  "scenario": "happy_path|paid_retry_timeout|paid_retry_500|duplicate_request|invalid_schema",
  "provider": "cmc|exa|weather|market_signal_batch",
  "resource": "https://...",
  "priceUsdc": 0.01,
  "status": 200,
  "success": true,
  "errorStage": null,
  "timingMs": {
    "total": 0,
    "probe": 0,
    "policy": 0,
    "noteDepositOrLoad": 0,
    "payment": 0,
    "retryFetch": 0,
    "validation": 0,
    "receiptWrite": 0
  },
  "payment": {
    "network": "eip155:8453",
    "asset": "USDC",
    "payer": "0x...",
    "payTo": "0x...",
    "paymentTx": "0x...",
    "paymentResponseSuccess": true
  },
  "integrity": {
    "requestHash": "sha256...",
    "responseHash": "sha256...",
    "responseHashMatches": true,
    "schemaPass": true
  },
  "idempotency": {
    "requestId": "stable-id",
    "duplicatePayment": false,
    "recoveredFunds": false,
    "recoveryPath": "data/recovery/..."
  }
}
```

## Speed Experiment

Run at least:

| Mode | Provider | Runs | Spend | Purpose |
|---|---|---:|---:|---|
| direct API | CMC or equivalent direct API key | 10 | normal API quota | lower-bound business API latency |
| raw x402 | CMC | 10 | `0.10 USDC` | x402 payment overhead without privacy note |
| adapter | CMC | 10 | `0.10 USDC` | privacy adapter overhead |
| raw x402 | Exa | 10 | `0.07 USDC` | x402 search overhead |
| adapter | Exa | 10 | `0.07 USDC` | privacy adapter search overhead |

Report:

- median / p95 total latency;
- median / p95 payment latency;
- retry-fetch latency after proof;
- validation and receipt-write overhead;
- success count and failure count.

The fair comparison is:

```text
direct API = business endpoint only
raw x402 = quote -> pay -> retry -> result
adapter = quote -> policy -> private payment -> retry -> validation -> receipt
```

Do not claim the adapter is faster than direct API. The useful claim is whether the adapter overhead is predictable and acceptable for autonomous paid tool calls.

## Failure Injection Matrix

These are the missing experiments from the current demo.

| Scenario | Injection Point | Expected Behavior | Evidence To Record |
|---|---|---|---|
| payment succeeds, retry never sent | after private payment / before retry fetch | recovery file exists, note state clear, no duplicate payment on rerun with same request id | payment tx, recovery path, unresolved delivery |
| payment succeeds, retry times out | retry fetch timeout at 1 ms or network abort | mark `paid_delivery_unknown`, keep recovery material, do not auto-pay again without idempotency decision | timeout stage, payment proof, request hash |
| provider returns 500 after payment | retry fetch receives HTTP 500 | record paid failure receipt, response hash, provider status, no schema pass | receipt with status 500 |
| provider returns invalid JSON | retry fetch HTTP 200 but malformed body | schema validation fails; payment counted, result not agent-usable | validator error |
| duplicate 402 / repeated command | same `requestId` run twice | second run should detect prior paid attempt and avoid duplicate payment, or clearly require user override | duplicate payment count |
| unsupported merchant | resource outside allowlist | blocked before payment | policy error, no tx |
| over budget | price greater than `MAX_USD_PER_CALL` | blocked before payment | budget error, no tx |

### Implementation Shape

Add an eval-only harness instead of weakening the product path:

```text
scripts/run-paid-tool-latency-eval.mjs
scripts/run-paid-tool-fault-eval.mjs
data/eval/runs.jsonl
data/eval/summary.json
data/eval/summary.md
```

The harness should call shared adapter internals or a thin exported wrapper, but keep real-spend commands behind:

```text
EVAL_REAL_SPEND=I_UNDERSTAND_THIS_SPENDS_USDC
```

Recommended fault flags:

```text
--inject after-payment-before-retry
--inject retry-timeout
--inject retry-http-500
--inject invalid-json
--request-id fixed-demo-id-001
```

## Raw x402 Baseline

Use the existing legacy script as the raw baseline:

```bash
RESOURCE_URL="https://..." X402_CHAIN=base node scripts/call-x402-resource.cjs
```

For a fair raw-vs-adapter comparison, record:

- `startedAt`;
- first 402 probe completed;
- payment proof produced;
- retry response headers received;
- body parsed;
- total elapsed.

Raw x402 should not use privacy notes, policy checks, receipt hashing, or recovery files.

## Direct API Baseline

Use a provider's ordinary API-key path when available. Direct API is not privacy-preserving and not x402, but it gives the lower-bound latency for the business data itself.

Record:

- request start / response end;
- HTTP status;
- schema validation;
- provider-side elapsed if exposed.

If no direct API key is available during the hackathon, label this row `not run` rather than inventing a number.

## High Trade-Intent Paid Service Candidates

Queried on 2026-06-10 through Coinbase x402 Bazaar discovery with:

```bash
node scripts/search-bazaar.mjs crypto trading market intelligence
```

Strongest candidates:

| Candidate | Resource | Price | Why It Helps Demo | Risk |
|---|---|---:|---|---|
| Market signal batch | `https://orbisapi.com/proxy/market-signal-api-c2fb7d/batch` | `0.1 USDC` | Clearly resembles buying trading signals; high-ticket vs current `0.017 USDC` demo | Need schema/probe; unknown endpoint params |
| Market intelligence v1 | `https://orbisapi.com/proxy/market-intelligence-api-5a2e4e/v1/market-intelligence` | `0.028 USDC` | Sentiment/trend direction is direct trade intent | Need schema/probe |
| Market report | `https://bazaar-gateway.vercel.app/api/market-report` | `0.02 USDC` | AI-generated crypto market report is easy for judges to understand | May be more narrative than actionable |
| Market signal basic | `https://orbisapi.com/proxy/market-signal-api-c2fb7d` | `0.005 USDC` | Cheap smoke test for same service family | Less "expensive" than current combined CMC+Exa flow |
| Crypto sentiment | `https://orbisapi.com/proxy/cryptointel-ec32ad/market/sentiment` | `0.001 USDC` | Explicit sentiment signal | Too cheap to prove high-value behavior |

Recommended demo path:

1. Dry probe `market-signal-api-c2fb7d/batch`.
2. Add a narrow allowlist entry only for that exact resource.
3. Set `MAX_USD_PER_CALL=0.12`.
4. Ensure private note balance is at least `0.103 USDC`.
5. Run one paid call.
6. Validate that output has at least one of: `signal`, `sentiment`, `trend`, `asset`, `recommendation`, `confidence`, `timestamp`.
7. Show the purchase as "the agent bought a higher-value market signal, while keeping the research payer separate from any trading wallet."

Do not present this as financial advice. Present it as an example of intent-sensitive paid research.

## Demo Narrative

Use this sequence:

```text
First, cheap research:
  CMC price data 0.01 USDC + Exa catalyst search 0.007 USDC.

Then, stronger intent:
  one higher-ticket market-signal purchase, around 0.02-0.10 USDC.

Evaluation:
  how long each path takes;
  whether paid failures are recoverable;
  whether duplicate payment is avoided;
  whether receipts and response hashes prove what happened.
```

The judge-facing claim should be:

```text
We are not just showing that an agent can pay.
We are measuring whether paid tool calls are fast enough, recoverable under awkward failures,
and safe enough to use for intent-sensitive research.
```
