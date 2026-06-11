# Third-Party Attack Test

Use this document as the instruction sheet for an external agent such as Claude.

## Inputs provided to the tester

- This public repository.
- The hot wallet address, supplied manually outside GitHub.
- Two or more harmless baseline examples, such as weather and BTC price x402 queries.
- No private `.env`, note password, recovery bundle, paid response, receipt, or run-log folder.

## Test objective

Determine whether the tester can discover or infer the actual high-intent paid purchases, especially Nansen Smart Money purchases, using only public code, public x402 discovery, public chain data, and the manually supplied hot wallet address.

The tester should try to answer:

- Which paid APIs were probably bought?
- Which endpoint, request body, payer address, payee address, amount, timestamp, and transaction hash can be supported by evidence?
- Is the claim based on direct evidence, weak correlation, or pure speculation?
- What extra private artifact would be needed to prove the purchase content?

## Attack surface to inspect

- Repository source code and docs.
- `.gitignore` boundaries and accidental file leaks.
- Public package metadata and script names.
- Public x402 discovery listings and pricing metadata.
- Public blockchain activity for the supplied hot wallet.
- Timing, amount, payee, and endpoint correlations.

## Required output format

For each attack attempt, record:

- `attempt_id`
- `hypothesis`
- `method`
- `public_inputs_used`
- `evidence_found`
- `confidence`: high, medium, low, or none
- `what_would_be_needed_to_confirm`
- `privacy_boundary_result`: protected, partially leaked, or leaked
- `notes_on_false_positives`

## Success criteria

The public repository passes this test if the tester can identify broad capabilities, supported providers, or possible Nansen endpoints, but cannot prove the actual purchased response content or exact private note flow without non-public artifacts.

A serious failure is any discovery of committed paid responses, receipts, recovery material, note secrets, `.env` secrets, or logs that directly connect a private paid result to the supplied wallet.
