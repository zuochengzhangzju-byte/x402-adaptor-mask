# x402-adaptor-mask

Open-source demo of a privacy-aware x402 payment adaptor for autonomous paid tool calls.

The narrow product claim:

```text
agent -> privacy adaptor -> x402 paid market/search/tool API
```

The adaptor helps a user run small paid research calls from a disposable Base wallet and encrypted
px402 note, while keeping durable payment material, receipts, responses, and recovery files local.
It is not a production privacy wallet and does not hide prompts, IP metadata, provider-side account
metadata, or future trading activity.

## What Is Included

- `bin/privacy-adapter.js` - CLI wrapper for Base USDC x402 calls through a private-note flow.
- `scripts/probe-x402-resource.mjs` - dry probe for public x402 resources without paying.
- `scripts/evaluate-paid-tool-module.mjs` - local receipt/response evaluator for your own run data.
- `assets/` - request bodies for public experiments, including Nansen Smart Money endpoint shapes.
- `docs/` - CLI, security review, adapter spec, red-team test, and evaluation notes.
- `px402-spike/package.json` - isolated dependency bundle used by the adaptor runtime.

This repository intentionally excludes live payment notes, recovery bundles, paid API responses,
receipts, run logs, private `.env` files, and real purchase transcripts.

## Install

Install the runtime dependencies in the nested dependency folder:

```bash
npm --prefix px402-spike install
```

Root `package.json` intentionally has no runtime dependencies. The CLI imports the pinned spike
dependency bundle through `createRequire`.

## Quickstart

Commands that do not need wallet config:

```bash
npm run privacy -- help
npm run privacy -- summarize
npm run probe:x402 -- --url https://api.nansen.ai/api/v1/smart-money/netflow --method POST --body-file ./assets/nansen-smart-money-netflow-request.json
npm run demo:nansen -- --dataset netflow --dry-run
```

For wallet commands, use a fresh low-value Base wallet. Address-only funding is enough to receive
USDC/ETH, but real x402 spend needs a local signer, so the CLI must be run with the disposable
wallet private key available locally.

Recommended local setup:

```bash
npm run privacy -- init
```

`init` creates `.env`, generates a random `PX402_NOTE_PASSWORD`, and refuses to overwrite an
existing `.env` unless `--force` is supplied. It does not print the generated password.

Then fill only local secrets in `.env`:

```env
PRIVATE_KEY=your_disposable_low_value_base_wallet_private_key
0X_API_KEY=optional_0x_dashboard_key
ZEROX_API_KEY=optional_0x_dashboard_key
```

For hackathon-only real spend, you must also acknowledge the current PRXVT circuit limitation:

```env
PRXVT_REMOTE_CIRCUITS_ACK=I_UNDERSTAND_UNPINNED_REMOTE_CIRCUITS
```

That acknowledgement is not a production fix. See `docs/SECURITY_REVIEW.md`.

## Wallet Commands

```bash
npm run doctor
npm run privacy -- prepare --dry-run
npm run demo:market -- --providers cmc,exa --symbol ETH --query "Ethereum market structure and Base ecosystem catalyst" --dry-run
```

Real-spend demo, after funding the disposable wallet and setting the acknowledgement:

```bash
npm run privacy -- prepare
npm run demo:market -- --providers cmc,exa --symbol ETH --query "Ethereum market structure and Base ecosystem catalyst"
```

Nansen-shaped research probe:

```bash
npm run demo:nansen -- --dataset netflow --dry-run
```

If a private payment withdraws to a burner but the provider retry fails, encrypted recovery files
can be listed and inspected:

```bash
npm run privacy -- recover:list
npm run privacy -- recover:sweep --file data/recovery/recovery-....json
npm run privacy -- recover:sweep --file data/recovery/recovery-....json --destination 0x... --sign-only
```

Recovery is sign-only by default. It writes an EIP-3009 authorization file under `data/recovery`
and does not broadcast. Broadcast that authorization only from an unlinkable relayer or gas wallet.
Do not sweep back to the configured hot wallet and do not broadcast from that hot wallet: either one
creates an onchain burner-to-wallet link and defeats this privacy boundary.

## Privacy Boundary

Useful protection:

- separates research-payment wallet/note from future trading wallets;
- enforces Base USDC, provider allowlists, per-call caps, and monthly budget;
- keeps notes and burner recovery material encrypted locally;
- records receipts and response hashes for agent-side audit.

Not protected:

- prompts, request bodies, or endpoint paths from the paid provider;
- IP/network metadata;
- provider account metadata and any provider-side policy checks;
- timing/amount correlation if a watcher already knows the hot wallet;
- recovery sweeps broadcast from, or sent back to, the hot wallet;
- production-grade ZK circuit integrity, because remote PRXVT circuits are not hash-pinned here.

## Never Publish

Keep these local only:

- `.env`
- `data/notes`
- `data/recovery`
- `data/receipts`
- `data/responses`
- `data/run-logs`
- `px402-spike/notes`

Use `docs/THIRD_PARTY_ATTACK_TEST.md` before a public release: a public repo should reveal
capabilities and possible endpoints, not live private paid results or note material.
