# Security Review Notes

## Current Status

This project is a hackathon privacy-payment adapter, not a production privacy wallet.

The hackathon goal is transaction-linkability reduction for x402 paid tool calls:

```text
agent -> x402 adapter -> pluggable privacy rail -> paid tool
```

The current implementation uses PRXVT as the first privacy rail and keeps the adapter boundary
intentionally narrow so other rails, such as Curvy-style or future shielded pools, can be swapped in.
Security findings below are about this implementation and deployment setting, not a claim that the
adapter pattern itself is limited to PRXVT.

What this review does not prove:

```text
prompt privacy
response/content privacy
IP privacy
provider-account privacy
production-grade ZK circuit integrity
transaction unlinkability under a low-activity upstream pool
```

Local notes, recovery files, receipts, and paid responses are still treated as sensitive local
artifacts, but "not recovered by this red-team run" should not be read as a proof of content
privacy.

## Findings And Mitigations

### Public Default PX402_NOTE_PASSWORD

Finding:

```text
Missing PX402_NOTE_PASSWORD previously fell back to local-dev-password-change-me.
That password protects encrypted notes and recovery blobs.
```

Mitigation:

```text
Fixed in bin/privacy-adapter.js.
The CLI now refuses empty passwords, the old public default, and passwords shorter than 12 chars.
px402-spike funded legacy scripts use the same rejection.
```

### Remote PRXVT Circuits Without Hash Pinning

Finding:

```text
@prxvt/sdk defaults to downloading wasm/zkey from https://circuits.prxvt.com.
The adapter does not hash-pin those artifacts, so it cannot prove exactly which circuit/proving key
was used.
```

Mitigation / avoidance:

```text
Real spend now requires:
PRXVT_REMOTE_CIRCUITS_ACK=I_UNDERSTAND_UNPINNED_REMOTE_CIRCUITS
```

This is an explicit hackathon-only acknowledgement, not a production fix. A production path should
vendor the wasm/zkey, pin hashes, verify before proving, and ideally pin the verification key against
the deployed verifier contract.

### PRXVT publicSignals Nullifier Ordering

Finding:

```text
The inspected SDK build uses publicSignals[1] for cross-chain attestation nullifierHash and
publicSignals[0] in the returned PaymentResult.nullifierHash.
```

Mitigation / avoidance:

```text
The main adapter is Base-only and selects only Base USDC x402 payment requirements.
It does not use PaymentResult.nullifierHash as spend authority.
Cross-chain / attestor usage is out of scope and should remain disabled until the SDK/circuit public
signal order is audited against the circuit source and onchain verifier.
```

### Missing Resource / Method / Host Binding

Finding:

```text
Budget and Base USDC filtering existed, but provider resource, method, and host were not hard
invariants before payment.
```

Mitigation:

```text
Fixed in bin/privacy-adapter.js.
The adapter now allowlists provider method, origin, and path before probing and again checks the
x402 challenge resource before payment.
```

Current allowlist:

```text
cmc:                       GET  https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest
exa:                       POST https://api.exa.ai/search
weather:                   GET  https://httpay.xyz/api/weather
nansen_netflow:            POST https://api.nansen.ai/api/v1/smart-money/netflow
nansen_holdings:           POST https://api.nansen.ai/api/v1/smart-money/holdings
nansen_perp_trades:        POST https://api.nansen.ai/api/v1/smart-money/perp-trades
nansen_tgm_flow_intelligence:
                           POST https://api.nansen.ai/api/v1/tgm/flow-intelligence
```

### Spike Scripts Bypass Main Adapter

Finding:

```text
px402-spike scripts can call sdk.wrapFetch(fetch), depositFast, or other raw SDK paths without the
main adapter's budget, provider allowlist, recovery, and circuit-risk gates.
```

Mitigation:

```text
Funded spike scripts now require:
ALLOW_UNGUARDED_SPIKE_FUNDED=I_UNDERSTAND_SPIKE_BYPASSES_MAIN_ADAPTER
```

Funded notes should use:

```text
npm run privacy -- prepare
npm run demo:market -- --providers cmc,exa --symbol ETH --query "..."
```

### Recovery Sweep Collapses The Anonymity Set

Finding:

```text
The first public recovery design swept residual burner USDC back to cfg.account.address and
broadcast the EIP-3009 transferWithAuthorization from cfg.account.
That creates direct public graph edges:
provider payment <- burner -> hot wallet
and tx.from hot wallet -> burner authorization.
```

Mitigation:

```text
Fixed in bin/privacy-adapter.js.
recover:sweep no longer defaults to the configured hot wallet as destination.
recover:sweep without flags is dry-run only.
recover:sweep --sign-only --destination <unlinkable_address> writes an authorization file and does
not broadcast.
recover:sweep --execute now refuses unless --allow-linking-sweep is explicitly passed.
```

Safe recovery requires broadcasting the signed authorization from an unlinkable relayer or gas
wallet and sending funds to a destination that is not the configured research hot wallet. The
adapter cannot make recovery private if the user chooses a linked destination or linked broadcaster.

### Immediate Deposit Then Payment In A Small Pool

Finding:

```text
The red-team report showed a 0.1 USDC hot-wallet deposit followed by a 0.05 USDC unshield and
provider payment about 2.5 minutes later. In the observed window, the pool had only one matching
unshield, so the effective anonymity set was approximately 1.
```

Mitigation:

```text
Fixed in bin/privacy-adapter.js.
market, nansen, and smoke:weather no longer auto-prepare by default.
Real paid calls require an existing note that is older than MIN_NOTE_AGE_MINUTES, default 60.
prepare writes privacyReadyAt into encrypted note metadata.
--auto-prepare --allow-fresh-note exists only for unsafe demos.
```

This does not create anonymity if the upstream pool itself has little activity. It only prevents the
adapter from creating the easiest "deposit immediately followed by payment" timing signature by
default.

### Exact Unshield Amount Equals Provider Price

Finding:

```text
The pool-to-burner unshield amount matched the provider payment amount exactly. That exact amount is
a strong correlation handle when the pool is quiet.
```

Mitigation:

```text
Fixed / configurable in bin/privacy-adapter.js.
BURNER_FUNDING_BUCKET_USD can fund the burner with a fixed bucket, for example 0.1 USDC, while the
provider still receives the exact x402 price.
Receipts record burnerFundUsdc and burnerRemainderUsdc because note delta may intentionally differ
from provider price.
```

This mitigation trades privacy for capital efficiency and residual burner balances. Residual
balances should not be swept through the hot wallet; use the sign-only recovery path.

## Remaining Production Gaps

```text
No local circuit hash pinning yet.
No independent audit of PRXVT SDK public signal order.
No prompt/IP privacy.
No provider-side identity unlinkability.
No merchant payTo pinning; provider payTo can rotate within an allowlisted resource.
Recovery privacy depends on an unlinkable relayer/gas wallet and unlinkable destination.
Timing privacy still depends on real anonymity-set size in the upstream pool.
Amount privacy requires a nonzero BURNER_FUNDING_BUCKET_USD and careful residual handling.
No packaged one-command installer yet; `npm --prefix px402-spike install` is still required.
```
