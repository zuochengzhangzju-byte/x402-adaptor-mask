# Privacy Adapter CLI

## What This Demo Does

This is the hackathon product path:

```text
trade research agent
  -> privacy adapter CLI
  -> CMC x402 market data
  -> Exa x402 search evidence
  -> local market signal
  -> encrypted note + receipts
```

The privacy claim is narrow:

```text
The research-payment note/burner is separated from any future trading wallet.
This does not hide prompts, IP metadata, provider-side account metadata, or future trading execution.
```

## User Setup

Install dependencies first:

```bash
npm --prefix px402-spike install
```

Then create a local `.env`. Recommended:

```bash
npm run privacy -- init
```

`init` creates `.env`, generates a random `PX402_NOTE_PASSWORD`, and refuses to overwrite an
existing `.env` unless `--force` is supplied. It does not print the generated password.

Required:

```env
PRIVATE_KEY=<disposable_low_value_wallet_private_key>
PX402_NOTE_PASSWORD=<local_note_password_generated_by_init>
X402_CHAIN=base
```

`PX402_NOTE_PASSWORD` is mandatory, must be at least 12 characters, and cannot be the old public
demo default.

For real-spend hackathon runs, acknowledge the current PRXVT SDK circuit limitation:

```env
PRXVT_REMOTE_CIRCUITS_ACK=I_UNDERSTAND_UNPINNED_REMOTE_CIRCUITS
```

Leave it empty for no-spend review and dry-runs. This acknowledgement is not a production circuit
integrity fix; see `SECURITY_REVIEW.md`.

`PRIVATE_KEY` must be a user-owned disposable low-value Base wallet. A wallet address alone can
receive funds, but real x402 spend needs a local signer.

Optional for one-command dust-ETH onboarding:

```env
0X_API_KEY=your_0x_dashboard_key
ZEROX_API_KEY=your_0x_dashboard_key
```

Spend controls:

```env
MAX_USD_PER_CALL=0.02
MONTHLY_BUDGET_USD=20
MIN_NOTE_AGE_MINUTES=60
AUTO_PREPARE_BEFORE_PAYMENT=false
BURNER_FUNDING_BUCKET_USD=0
MIN_BASE_ETH_BUFFER=0.00005
ZEROX_DUST_USDC=0.1
```

Privacy timing controls:

- `MIN_NOTE_AGE_MINUTES=60` means real paid calls refuse fresh notes until the wait window passes.
- `AUTO_PREPARE_BEFORE_PAYMENT=false` means `market`, `nansen`, and `smoke:weather` do not deposit
  immediately before paying.
- `BURNER_FUNDING_BUCKET_USD=0` keeps exact burner funding. Set a fixed bucket such as `0.1` to
  reduce amount correlation between the pool unshield and provider price. The unused remainder
  stays on the burner unless recovered through the sign-only recovery path.

The wallet should hold a small amount of Base USDC. If it has too little native Base ETH, the CLI
can use 0x Gasless to buy dust ETH with USDC.

## Commands

```text
npm run privacy -- help
```

Prints usage. Does not require wallet config.

```text
npm run privacy -- init [--allow-unpinned-circuits] [--force]
```

Creates a local `.env`. Does not require wallet config. If `PRIVATE_KEY` is present in the process
environment, it writes it into `.env`; otherwise it leaves `PRIVATE_KEY=` blank for local editing.

```text
npm run privacy -- doctor
```

Checks env, wallet balances, note state, and budget state. Does not spend.

```text
npm run privacy -- prepare --dry-run
```

Shows whether the CLI would buy dust ETH or deposit into a px402 note. Does not spend.

```text
npm run privacy -- prepare
```

Ensures enough dust ETH and creates or tops up the encrypted px402 note.
For privacy, run this ahead of the paid call and wait until the returned `privacyReadyAt` time.

```text
npm run demo:market -- --dry-run --symbol ETH --query "Ethereum market structure and Base ecosystem catalyst"
```

Probes CMC and Exa x402 v2 payment requirements. Does not sign or spend.

```text
npm run demo:market -- --symbol ETH --query "Ethereum market structure and Base ecosystem catalyst"
```

Runs the tiny real-funds demo:

```text
preprepared privacy-ready note
  -> private CMC x402 call
  -> private Exa x402 call
  -> local signal JSON
  -> receipts
```

By default this command does not deposit immediately before paying. If the note is missing,
underfunded, or too fresh, it fails with instructions to run `prepare` first. Use
`--auto-prepare --allow-fresh-note` only for unsafe demos where timing privacy is intentionally out
of scope.

Confirmed headline command today:

```text
npm run demo:market -- --providers cmc,exa --symbol ETH --query "Ethereum market structure and Base ecosystem catalyst"
```

Confirmed provider prices in the current demo:

```text
CMC quotes/latest: 0.01 USDC
Exa /search: 0.007 USDC
Combined demo: 0.017 USDC
```

```text
npm run privacy -- summarize
```

Rebuilds an agent-readable market signal from the latest saved paid responses. This does not spend.
It does not require wallet config, but it needs local response files to produce a meaningful signal.

```text
npm run privacy -- recover:list
npm run privacy -- recover:sweep --file data/recovery/recovery-....json
npm run privacy -- recover:sweep --file data/recovery/recovery-....json --destination 0x... --sign-only
```

Lists encrypted failure-recovery files, dry-runs recovery, or creates a signed EIP-3009 recovery
authorization. The safe default does not broadcast from the disposable research wallet and does not
send funds back to it.

Use `--sign-only --destination <unlinkable_address>` to write an authorization file under
`data/recovery`. Broadcast that authorization only from an unlinkable relayer or gas wallet. If the
configured hot wallet broadcasts the transaction, `tx.from` links the hot wallet to the burner. If
the destination is the hot wallet, the USDC transfer itself links the burner to the hot wallet.

`--execute --allow-linking-sweep` exists only for unsafe local debugging and defeats the recovery
privacy boundary.

```text
npm run privacy -- smoke:weather --dry-run
```

Keeps the already validated weather endpoint as a smoke test.

## Output Files

Default local paths:

```text
data/notes
data/receipts
data/responses
data/recovery
```

Notes are encrypted with `PX402_NOTE_PASSWORD`. Receipts include provider, endpoint metadata,
price, request/response hashes, note balance before/after, and payment references. Paid response
bodies are stored in `data/responses` for demo inspection and signal parsing.

If a private payment withdraws to a burner wallet but the paid provider rejects the retry request,
the burner private key is written to `data/recovery` encrypted with `PX402_NOTE_PASSWORD`. This is
only a failure-recovery path and should be treated as sensitive local data.

## Current Implementation Notes

- Root `npm install` for latest `x402@1.2.0` was unstable in this Windows workspace, so the CLI
  implements a thin x402 v2 EIP-3009 adapter directly.
- The CLI reuses the already working `px402-spike` dependency bundle for PRXVT SDK, viem, undici,
  and snarkjs.
- Root `hackathon/package.json` intentionally has no runtime dependencies. `npm ls --depth=0`
  is clean; the product CLI imports the pinned spike dependency bundle through `createRequire`.
- CMC and Exa return x402 v2 payloads with `network: eip155:8453`; the adapter selects only Base
  USDC.
- The adapter is Base-only and checks provider method, origin, path, and x402 challenge resource
  before payment.
- `market --dry-run` has verified:
  - CMC price: `0.01 USDC`;
  - Exa price: `0.007 USDC`;
  - both have Base USDC payment options.
- CMC and Exa private x402 v2 are confirmed with HTTP 200.
- Exa requires the v2 payment payload to include `scheme` and `network`; CMC accepted the narrower
  payload but Exa's facilitator rejected it.
- Failed provider retries create encrypted recovery files before the paid retry is attempted. Two
  failed burner balances were swept back successfully during validation.
- After the red-team timing-correlation review, real paid calls no longer auto-prepare by default
  and now enforce `MIN_NOTE_AGE_MINUTES` unless `--allow-fresh-note` is explicitly passed.
- Optional `BURNER_FUNDING_BUCKET_USD` normalizes the pool-to-burner unshield amount. This improves
  amount unlinkability but leaves public residual USDC on the burner.

## Review Checklist

- No private key, decrypted note, note password, or burner private key should appear in stdout.
- Burner recovery files must be encrypted and never printed.
- `.env`, `data/notes`, `data/recovery`, and spike notes must not be committed or shared.
- `doctor`, `prepare --dry-run`, and `market --dry-run` must not sign or spend.
- `summarize` must not sign or spend.
- `recover:sweep` without `--execute` must not sign or spend.
- `recover:sweep --sign-only --destination ...` signs an EIP-3009 authorization but must not
  broadcast.
- `market`, `nansen`, and `smoke:weather` must not auto-deposit before payment unless
  `--auto-prepare` or `AUTO_PREPARE_BEFORE_PAYMENT=true` is set.
- Real paid calls must reject fresh notes unless `--allow-fresh-note` or `MIN_NOTE_AGE_MINUTES=0`
  is set.
- Real-spend paths are `prepare`, `market`, and `smoke:weather` without `--dry-run`.
- `recover:sweep --execute --allow-linking-sweep` is unsafe: it signs a recovery authorization,
  broadcasts from the disposable wallet, and creates an onchain link between the hot wallet and the
  burner.
- Receipts should contain hashes and public payment metadata only.
- Trading wallet keys are out of scope and must not be added to `.env`.
