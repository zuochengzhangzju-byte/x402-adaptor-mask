# Tool Calling Module Evaluation Metrics

## Scope

This evaluates the agent-side module that discovers, pays for, calls, validates, and records tool usage. Privacy is out of scope for the baseline benchmark.

## Core Metrics

### 1. End-to-end latency

Measure from agent decision to final usable result.

```text
t_total = quote/discovery + payment + retry + tool execution + validation + logging
```

Report:

- median latency;
- p95 latency;
- cold-start latency;
- payment overhead vs direct API call.

### 2. Success rate

Percentage of calls that produce a usable result.

Break down by failure source:

- marketplace discovery failed;
- payment requirement parse failed;
- wallet/payment failed;
- retry failed;
- provider returned error;
- result schema invalid;
- validator failed.

### 3. Cost correctness

The module should not overspend or misread prices.

Report:

- quoted price;
- paid price;
- local ledger price;
- mismatch count;
- blocked over-budget calls.

### 4. Policy correctness

Measures whether the module enforces local rules.

Test cases:

- allowed merchant passes;
- blocked merchant fails;
- max-per-call exceeded;
- monthly budget exceeded;
- unsupported asset/network blocked;
- human approval threshold triggered.

### 5. Result validity

Tool output should be usable by the agent.

Report:

- schema pass rate;
- required fields present;
- deterministic validator pass rate;
- response hash recorded;
- malformed response handling.

### 6. Idempotency and retry safety

Payment systems fail in awkward ways. The module should avoid double payment.

Test cases:

- payment succeeds, resource retry fails;
- provider returns duplicate 402;
- network timeout after payment;
- retry with same request id;
- repeated command invocation.

Report:

- duplicate payment count;
- recovered call count;
- unresolved payment count.

### 7. Agent usability

How easy it is for an agent to use the module.

Report:

- number of required parameters;
- whether output is structured JSON;
- whether errors are machine-readable;
- whether receipts are file-backed;
- whether the command is one-shot.

## Comparison Baselines

Compare against:

1. Direct API key call.
2. Manual x402 payment script.
3. x402 call without policy/receipt/validation.
4. This module with policy/receipt/validation enabled.

## Demo Table

Use a small table in the final presentation:

| Flow | Success | Median Latency | Duplicate Payments | Budget Violations | Receipt | Validation |
|---|---:|---:|---:|---:|---:|---:|
| direct API | TBD | TBD | N/A | N/A | no | optional |
| raw x402 | TBD | TBD | TBD | TBD | partial | no |
| our module | TBD | TBD | TBD | 0 expected | yes | yes |

## Strongest Demo Claim

The module does not need to be faster than a direct API key. It needs to be more reliable and safer for autonomous paid tool use:

```text
agent can pay, avoid overspend, avoid duplicate payment, record evidence, and return validated results.
```
