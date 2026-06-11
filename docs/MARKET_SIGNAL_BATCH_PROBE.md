# Market Signal Batch Dry Probe

Resource:

```text
https://orbisapi.com/proxy/market-signal-api-c2fb7d/batch
```

Dry probe date:

```text
2026-06-10
```

## What It Sells

The x402 challenge describes the service as:

```text
AI market signals combining technical and fundamental analysis for crypto
```

The challenge tags include:

```text
signals, ai, crypto, technical-analysis, fundamental, trading, buy-sell,
crypto market signal api, ai trading signal api, buy sell hold signal crypto,
technical analysis api, batch trading signals
```

This is more trade-intent revealing than the current CMC + Exa flow because the agent is explicitly buying a batch trading-signal endpoint.

## Payment Terms

Observed from dry probe:

```text
x402Version: 2
network: eip155:8453
asset: Base USDC
amount: 100000 micro USDC = 0.1 USDC
payTo: 0x2bb72231EeD303cc91a462A1fA738b42B6a9ac6d
mimeType: application/json
maxTimeoutSeconds: 60
```

## Request Shape

GET returns a 402 challenge and says the endpoint supports:

```text
method: GET
queryParams: {}
```

POST with valid JSON also returns a 402 challenge and says the endpoint supports:

```text
method: POST
bodyType: json
body: {}
```

The service does not publish a concrete input schema through Bazaar. Use a conservative JSON body:

```json
{
  "assets": ["ETH", "BTC", "BASE"],
  "horizon": "24h",
  "intent": "research_only",
  "strategy": "event-driven crypto market research",
  "include": ["trend", "sentiment", "technical", "fundamental", "risk"],
  "context": "Evaluate whether ETH and Base ecosystem catalysts justify further research. Do not execute trades."
}
```

Stored at:

```text
assets/market-signal-batch-request.json
```

## Probe Commands

GET dry probe:

```bash
npm run probe:x402 -- --url https://orbisapi.com/proxy/market-signal-api-c2fb7d/batch --method GET
```

POST dry probe:

```bash
npm run probe:x402 -- --url https://orbisapi.com/proxy/market-signal-api-c2fb7d/batch --method POST --body-file assets/market-signal-batch-request.json
```

## Expected Paid Result

The actual paid response is not known yet because the dry probe intentionally did not pay. Based on the service description, a useful result should contain some subset of:

```text
asset / symbol
signal or recommendation
direction: buy / sell / hold / bullish / bearish / neutral
confidence
technical analysis
fundamental analysis
sentiment
risk
timestamp or horizon
```

Accept the paid result as demo-useful if it returns at least:

```text
one asset identifier
one signal/direction field
one explanatory reason or analysis field
one timestamp/horizon/confidence/risk field
```

Do not present the output as financial advice. Present it as intent-sensitive paid research.
