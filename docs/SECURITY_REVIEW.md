# Security Review Notes

## Current Status

This project is a hackathon privacy-payment adapter, not a production privacy wallet.

The intended claim is narrow:

```text
Separate the research-payment note/burner path from future trading wallets.
Enforce provider allowlists and small spend budgets.
Keep local note/recovery material encrypted.
```

It does not currently prove prompt privacy, IP privacy, provider-account privacy, or production-grade
ZK circuit integrity.

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
cmc:     GET  https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest
exa:     POST https://api.exa.ai/search
weather: GET  https://httpay.xyz/api/weather
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

## Remaining Production Gaps

```text
No local circuit hash pinning yet.
No independent audit of PRXVT SDK public signal order.
No prompt/IP privacy.
No provider-side identity unlinkability.
No merchant payTo pinning; provider payTo can rotate within an allowlisted resource.
No packaged one-command installer yet.
```

