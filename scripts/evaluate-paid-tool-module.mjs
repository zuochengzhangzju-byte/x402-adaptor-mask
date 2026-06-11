#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const receiptDir = path.join(rootDir, "data", "receipts");
const outputDir = rootDir;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const [key, value] = item.slice(2).split("=", 2);
    out[key] = value ?? argv[i + 1];
    if (value === undefined) i += 1;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function latestMarketSignal() {
  const entries = fs.readdirSync(receiptDir)
    .filter((name) => /^market-signal-.*\.json$/.test(name))
    .map((name) => {
      const file = path.join(receiptDir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!entries[0]) throw new Error(`No market-signal JSON found in ${receiptDir}`);
  return entries[0].file;
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function decodePaymentResponse(encoded) {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function responseValidation(provider, body) {
  if (provider === "cmc") {
    const rows = Array.isArray(body.data) ? body.data : Object.values(body.data || {});
    const active = rows.find((item) => item?.is_active === 1) || rows[0] || {};
    const quoteRaw = active.quote || {};
    const quote = Array.isArray(quoteRaw)
      ? quoteRaw.find((item) => item?.symbol === "USD") || quoteRaw[0] || {}
      : quoteRaw.USD || {};
    const required = {
      symbol: Boolean(active.symbol),
      priceUsd: Number.isFinite(Number(quote.price)),
      volume24h: Number.isFinite(Number(quote.volume_24h)),
      marketCap: Number.isFinite(Number(quote.market_cap)),
    };
    return {
      schemaPass: Object.values(required).every(Boolean),
      required,
      summary: `${active.symbol || "unknown"} $${Number(quote.price || 0).toFixed(2)}`,
    };
  }
  if (provider === "exa") {
    const results = Array.isArray(body.results) ? body.results : [];
    const required = {
      requestId: Boolean(body.requestId),
      resultsPresent: results.length > 0,
      titleUrlPairs: results.every((item) => item.title && item.url),
    };
    return {
      schemaPass: Object.values(required).every(Boolean),
      required,
      summary: `${results.length} search results`,
    };
  }
  return { schemaPass: Boolean(body), required: {}, summary: "generic JSON response" };
}

function evaluateReceipt(file) {
  const receipt = readJson(file);
  const responsePath = receipt.responsePath;
  const responseText = responsePath && fs.existsSync(responsePath)
    ? fs.readFileSync(responsePath, "utf8")
    : "";
  const responseBody = responseText ? JSON.parse(responseText) : null;
  const paymentResponse = decodePaymentResponse(receipt.paymentResponse || receipt.xPaymentResponse);
  const validation = responseValidation(receipt.provider, responseBody);
  const responseHash = responseText ? sha256Text(responseText) : null;
  const quotePaidMatch = Number(receipt.priceUsdc) > 0
    && receipt.noteBalanceBeforeUsdc !== null
    && receipt.noteBalanceAfterUsdc !== null
    && Math.abs(
      (Number(receipt.noteBalanceBeforeUsdc) - Number(receipt.noteBalanceAfterUsdc)) - Number(receipt.priceUsdc),
    ) < 0.000001;

  const checks = {
    http200: receipt.status >= 200 && receipt.status < 300,
    baseUsdc: String(receipt.network).toLowerCase() === "eip155:8453"
      && String(receipt.asset).toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    paymentProofRecorded: Boolean(receipt.paymentTx && (receipt.paymentResponse || receipt.xPaymentResponse)),
    paymentResponseSuccess: Boolean(paymentResponse?.success),
    responseHashMatches: Boolean(responseHash && responseHash === receipt.responseHash),
    requestHashRecorded: Boolean(receipt.requestHash),
    receiptFileBacked: Boolean(responsePath && fs.existsSync(responsePath)),
    resultSchemaPass: validation.schemaPass,
    quotePaidMatch,
    recoveryPathRecorded: Boolean(receipt.recoveryPath),
  };

  return {
    provider: receipt.provider,
    receiptPath: path.relative(rootDir, file),
    responsePath: responsePath ? path.relative(rootDir, responsePath) : null,
    createdAt: receipt.createdAt,
    status: receipt.status,
    priceUsdc: Number(receipt.priceUsdc || 0),
    paymentTx: receipt.paymentTx,
    payer: receipt.payer,
    payTo: receipt.payTo,
    responseHash: receipt.responseHash,
    validation,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

function countDuplicatePayments(cases) {
  const seen = new Set();
  let duplicates = 0;
  for (const item of cases) {
    const key = item.paymentTx || `${item.provider}:${item.responseHash}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function makeMarkdown(report) {
  const lines = [];
  lines.push("# Paid Tool Module Evaluation");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Evidence source: \`${report.source.marketSignalPath}\``);
  lines.push("");
  lines.push("## Demo Table");
  lines.push("");
  lines.push("| Flow | Success | Cases | Total Cost | Duplicate Payments | Budget Violations | Receipt | Validation |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  lines.push(`| our module | ${report.summary.successRate} | ${report.summary.passedCases}/${report.summary.totalCases} | ${report.summary.totalCostUsdc.toFixed(3)} USDC | ${report.summary.duplicatePayments} | ${report.summary.budgetViolations} | yes | yes |`);
  lines.push("| direct API | not run | 0 | n/a | n/a | n/a | no | optional |");
  lines.push("| raw x402 | not run | 0 | n/a | n/a | n/a | partial | no |");
  lines.push("");
  lines.push("## Evidence Cases");
  lines.push("");
  lines.push("| Provider | Status | Price | Result | Hash | Payment Proof | Note Delta | Summary |");
  lines.push("|---|---:|---:|---|---|---|---|---|");
  for (const item of report.cases) {
    lines.push(`| ${item.provider} | ${item.status} | ${item.priceUsdc.toFixed(3)} USDC | ${item.checks.resultSchemaPass ? "pass" : "fail"} | ${item.checks.responseHashMatches ? "match" : "mismatch"} | ${item.checks.paymentProofRecorded ? "yes" : "no"} | ${item.checks.quotePaidMatch ? "matches price" : "check"} | ${item.validation.summary} |`);
  }
  lines.push("");
  lines.push("## What This Supports");
  lines.push("");
  lines.push("- The module can complete paid x402 calls for two real providers: CMC and Exa.");
  lines.push("- Receipts are file-backed and include payment proof, request hash, response hash, payer, payee, price, and recovery path.");
  lines.push("- Local validators can verify response shape and hash integrity without spending again.");
  lines.push("- The two successful cases show no overpayment relative to note balance delta.");
  lines.push("");
  lines.push("## Still Needed For Stronger Claims");
  lines.push("");
  for (const gap of report.gaps) lines.push(`- ${gap}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const marketSignalPath = path.resolve(rootDir, args.signal || latestMarketSignal());
  const signal = readJson(marketSignalPath);
  const receiptPaths = [signal.cmcReceipt, signal.exaReceipt]
    .filter(Boolean)
    .map((file) => path.resolve(file));
  if (receiptPaths.length === 0) throw new Error("Selected signal does not reference CMC/Exa receipts.");

  const cases = receiptPaths.map(evaluateReceipt);
  const totalCases = cases.length;
  const passedCases = cases.filter((item) => item.pass).length;
  const budgetViolations = cases.filter((item) => !item.checks.quotePaidMatch).length;
  const duplicatePayments = countDuplicatePayments(cases);
  const totalCostUsdc = cases.reduce((sum, item) => sum + item.priceUsdc, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      marketSignalPath: path.relative(rootDir, marketSignalPath),
      signal: signal.signal,
    },
    summary: {
      totalCases,
      passedCases,
      successRate: `${Math.round((passedCases / totalCases) * 100)}%`,
      totalCostUsdc,
      duplicatePayments,
      budgetViolations,
      receiptBackedCases: cases.filter((item) => item.checks.receiptFileBacked).length,
      validationPassCases: cases.filter((item) => item.checks.resultSchemaPass).length,
    },
    cases,
    gaps: [
      "Latency median/p95 needs repeated fresh runs with timestamps around discovery, payment, retry, provider execution, validation, and logging.",
      "Duplicate-payment safety needs induced failures: payment succeeds but provider retry fails, network timeout after payment, repeated request id, and duplicate 402.",
      "Policy correctness needs negative live/dry-run cases: blocked merchant, over max-per-call, over monthly budget, unsupported network/asset, human approval threshold.",
      "Provider reliability needs more than two cases, ideally 20-30 mixed CMC/Exa/weather runs or a small daily sample.",
      "Raw x402 and direct API baselines need separate runs if the demo wants comparative latency or success-rate claims.",
    ],
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "paid-tool-module-eval.json");
  const mdPath = path.join(outputDir, "paid-tool-module-eval.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, makeMarkdown(report));
  console.log(JSON.stringify({
    action: "evaluate_paid_tool_module",
    successRate: report.summary.successRate,
    totalCases,
    passedCases,
    totalCostUsdc,
    duplicatePayments,
    budgetViolations,
    jsonPath,
    markdownPath: mdPath,
  }, null, 2));
}

main();
