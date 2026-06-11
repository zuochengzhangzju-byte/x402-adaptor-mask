# px402 Spike

Isolated PRXVT / px402 SDK spike. Treat this folder as research-only.

This folder exists to avoid disturbing the main `hackathon/node_modules` tree, which already contains x402 and Curvy experiments.

Funded notes should use the main adapter:

```powershell
cd ..
npm run privacy -- help
```

The legacy funded scripts in this folder bypass the main adapter's budget checks, merchant
allowlist, failure recovery, and circuit-risk acknowledgement. They now refuse to run unless
`ALLOW_UNGUARDED_SPIKE_FUNDED=I_UNDERSTAND_SPIKE_BYPASSES_MAIN_ADAPTER` is set for isolated
debugging.

Run:

```powershell
node .\no-funds-check.mjs
npm run dry-run:weather
```

Rules:

- Do not call `deposit`, `depositFast`, `depositLegacy`, or `makePayment` during the no-funds phase.
- Do not read `../.env`.
- Do not use a private key.
- Do not run `deposit:min` or `call:weather` with a funded note unless you intentionally accept the
  unguarded legacy-script risk.
