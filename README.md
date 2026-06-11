# x402-adaptor-mask

Public test package for an x402 privacy adaptor demo. The goal is to let a third-party agent inspect the open-source adaptor, run harmless probes, and attempt to infer whether paid Nansen-style purchases happened from public code plus a manually supplied hot wallet address.

This repository intentionally excludes live payment notes, recovery bundles, paid API responses, receipts, run logs, private `.env` files, and any real purchase transcript.

## What is included

- `bin/privacy-adapter.js` - CLI wrapper for x402 calls through a private-payment note flow.
- `scripts/probe-x402-resource.mjs` - dry probe for x402 resources without paying.
- `scripts/evaluate-paid-tool-module.mjs` - local evaluation harness for response/receipt folders you provide yourself.
- `assets/` - request bodies for public experiments, including Nansen Smart Money endpoint shapes.
- `docs/THIRD_PARTY_ATTACK_TEST.md` - prompt and report format for an external red-team style test.
- `px402-spike/package.json` - dependency island used by the adaptor runtime.

## Setup

Install the runtime dependencies in the nested dependency folder:

```bash
cd px402-spike
npm install
cd ..
```

Create a local `.env` from `.env.example` and set only the values needed for the test you want to run. Do not commit `.env`.

```bash
cp .env.example .env
npm run doctor
```

## Harmless probes

Search or dry-probe public x402 listings:

```bash
npm run probe:x402 -- https://api.nansen.ai/api/v1/smart-money/netflow --method POST --body ./assets/nansen-smart-money-netflow-request.json
npm run demo:nansen -- --dataset netflow --dry-run
```

Basic public examples can be used for weather or BTC price style tests, but this repository is mainly structured around the privacy boundary: what an agent can infer without local receipts, responses, recovery material, or private notes.

## Payment safety

Real payment requires an explicit local funding setup and a password-protected note. Keep these files private:

- `data/notes*`
- `data/recovery*`
- `data/receipts*`
- `data/responses*`
- `data/run-logs`
- `.env`

For demos, prefer a fresh hot wallet with a small balance and a separate note password.
