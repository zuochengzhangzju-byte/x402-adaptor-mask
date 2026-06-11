#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const spikeRequire = createRequire(new URL("../px402-spike/package.json", import.meta.url));

loadDotEnv(path.join(rootDir, ".env"));

let viemMod;
let accountsMod;
let chainsMod;
let privacyMod;
let dispatcherReady = false;

function viem() {
  if (!viemMod) viemMod = spikeRequire("viem");
  return viemMod;
}

function accounts() {
  if (!accountsMod) accountsMod = spikeRequire("viem/accounts");
  return accountsMod;
}

function chains() {
  if (!chainsMod) chainsMod = spikeRequire("viem/chains");
  return chainsMod;
}

function privacy() {
  if (!privacyMod) privacyMod = spikeRequire("@prxvt/sdk");
  return privacyMod;
}

function setupFetchTimeouts() {
  if (dispatcherReady) return;
  const { Agent, setGlobalDispatcher } = spikeRequire("undici");
  setGlobalDispatcher(new Agent({
    connect: { timeout: 60_000 },
    headersTimeout: 120_000,
    bodyTimeout: 300_000,
  }));
  dispatcherReady = true;
}

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ALLOWED_DEPOSITS = [0.01, 0.1, 1, 10, 100];
const DEFAULT_NOTE_PASSWORD = "local-dev-password-change-me";
const REMOTE_CIRCUITS_ACK = "I_UNDERSTAND_UNPINNED_REMOTE_CIRCUITS";
const LINKING_SWEEP_WARNING = "hot-wallet broadcast or hot-wallet destination links the burner to the research wallet";
const DEFAULT_CMC_URL = "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest";
const DEFAULT_EXA_URL = "https://api.exa.ai/search";
const DEFAULT_WEATHER_URL = "https://httpay.xyz/api/weather?lat=22.3193&lon=114.1694";
const PROVIDER_POLICIES = {
  cmc: {
    method: "GET",
    origin: "https://pro-api.coinmarketcap.com",
    pathPrefix: "/x402/v3/cryptocurrency/quotes/latest",
  },
  exa: {
    method: "POST",
    origin: "https://api.exa.ai",
    pathPrefix: "/search",
  },
  weather: {
    method: "GET",
    origin: "https://httpay.xyz",
    pathPrefix: "/api/weather",
  },
  nansen_netflow: {
    method: "POST",
    origin: "https://api.nansen.ai",
    pathPrefix: "/api/v1/smart-money/netflow",
  },
  nansen_holdings: {
    method: "POST",
    origin: "https://api.nansen.ai",
    pathPrefix: "/api/v1/smart-money/holdings",
  },
  nansen_perp_trades: {
    method: "POST",
    origin: "https://api.nansen.ai",
    pathPrefix: "/api/v1/smart-money/perp-trades",
  },
  nansen_tgm_flow_intelligence: {
    method: "POST",
    origin: "https://api.nansen.ai",
    pathPrefix: "/api/v1/tgm/flow-intelligence",
  },
};
const USDC_EIP3009_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      out._.push(item);
      continue;
    }
    const [rawKey, rawValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (rawValue !== undefined) {
      out[key] = rawValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[i + 1];
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizePrivateKey(privateKey) {
  const cleaned = String(privateKey || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, "");
  const normalized = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("PRIVATE_KEY must be one 32-byte hex private key, with or without 0x prefix.");
  }
  return normalized;
}

function toBool(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").toLowerCase());
}

function jsonStringify(value) {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

function printJson(value) {
  console.log(jsonStringify(value));
}

function printError(value) {
  console.error(jsonStringify(value));
}

function newRunId(command = "run") {
  return `${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 16)}-${command}-${crypto.randomBytes(4).toString("hex")}`;
}

function relativeOrValue(value) {
  if (!value || typeof value !== "string") return value;
  const resolved = path.resolve(value);
  return resolved.toLowerCase().startsWith(rootDir.toLowerCase())
    ? path.relative(rootDir, resolved)
    : value;
}

function envLine(key, value) {
  return `${key}=${String(value || "")}`;
}

function randomLocalPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

function localEnvTemplate(args = {}) {
  const privateKey = process.env.PRIVATE_KEY || process.env.PX402_PRIVATE_KEY || "";
  const ack = args.allowUnpinnedCircuits ? REMOTE_CIRCUITS_ACK : "";
  return [
    "# Local file generated by privacy-adapter init.",
    "# Never commit this file. Never paste these values into chat.",
    "",
    "# User-owned disposable low-value Base wallet private key.",
    "# Address alone is not enough for real spend; the adapter needs a local signer.",
    envLine("PRIVATE_KEY", privateKey),
    "",
    envLine("X402_CHAIN", "base"),
    envLine("BASE_RPC_URL", process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    "",
    "# Random local encryption password for data/notes and data/recovery.",
    envLine("PX402_NOTE_PASSWORD", randomLocalPassword()),
    envLine("NOTE_DIR", "./data/notes"),
    envLine("RECEIPT_DIR", "./data/receipts"),
    envLine("RESPONSE_DIR", "./data/responses"),
    envLine("RECOVERY_DIR", "./data/recovery"),
    "",
    "# Hackathon real-spend acknowledgement for unpinned remote PRXVT circuits.",
    envLine("PRXVT_REMOTE_CIRCUITS_ACK", ack),
    "",
    envLine("MAX_USD_PER_CALL", process.env.MAX_USD_PER_CALL || "0.02"),
    envLine("MONTHLY_BUDGET_USD", process.env.MONTHLY_BUDGET_USD || "20"),
    envLine("MIN_NOTE_AGE_MINUTES", process.env.MIN_NOTE_AGE_MINUTES || "60"),
    envLine("AUTO_PREPARE_BEFORE_PAYMENT", process.env.AUTO_PREPARE_BEFORE_PAYMENT || "false"),
    envLine("BURNER_FUNDING_BUCKET_USD", process.env.BURNER_FUNDING_BUCKET_USD || "0"),
    envLine("MIN_BASE_ETH_BUFFER", process.env.MIN_BASE_ETH_BUFFER || "0.00005"),
    "",
    envLine("0X_API_KEY", process.env["0X_API_KEY"] || ""),
    envLine("ZEROX_API_KEY", process.env.ZEROX_API_KEY || process.env["0X_API_KEY"] || ""),
    envLine("ZEROX_CHAIN_ID", "8453"),
    envLine("ZEROX_DUST_USDC", process.env.ZEROX_DUST_USDC || "0.1"),
    "",
    envLine("CMC_SYMBOL", process.env.CMC_SYMBOL || "ETH"),
    envLine("EXA_QUERY", process.env.EXA_QUERY || "Ethereum market structure and Base ecosystem catalyst"),
    envLine("EXA_NUM_RESULTS", process.env.EXA_NUM_RESULTS || "3"),
    envLine("X402_WEATHER_URL", process.env.X402_WEATHER_URL || DEFAULT_WEATHER_URL),
    "",
  ].join("\n");
}

function appendRunLog(cfg, event) {
  if (!cfg?.runLogPath) return;
  ensureDir(path.dirname(cfg.runLogPath));
  const entry = {
    at: new Date().toISOString(),
    runId: cfg.runId,
    ...event,
  };
  fs.appendFileSync(cfg.runLogPath, `${JSON.stringify(entry, (_, item) => typeof item === "bigint" ? item.toString() : item)}\n`);
}

async function timedStage(cfg, stage, fn, meta = {}) {
  const startedAt = Date.now();
  appendRunLog(cfg, { event: "stage_start", stage, ...meta });
  try {
    const result = await fn();
    appendRunLog(cfg, { event: "stage_end", stage, elapsedMs: Date.now() - startedAt, ok: true });
    return result;
  } catch (error) {
    appendRunLog(cfg, {
      event: "stage_error",
      stage,
      elapsedMs: Date.now() - startedAt,
      ok: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    });
    throw error;
  }
}

function publicNoteSummary(noteAction) {
  if (!noteAction) return noteAction;
  if (noteAction.note) {
    return {
      ...noteAction,
      note: {
        file: noteAction.note.file,
        balance: noteAction.note.balance,
        privacyReadyAt: noteAction.note.privacyReadyAt || null,
      },
    };
  }
  return noteAction;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function requiredNotePassword() {
  const raw = String(process.env.PX402_NOTE_PASSWORD || "").trim();
  if (!raw) {
    throw new Error("PX402_NOTE_PASSWORD is required. Refusing to use a public default for note/recovery encryption.");
  }
  if (raw === DEFAULT_NOTE_PASSWORD) {
    throw new Error(`PX402_NOTE_PASSWORD must not be the public default '${DEFAULT_NOTE_PASSWORD}'.`);
  }
  if (raw.length < 12) {
    throw new Error("PX402_NOTE_PASSWORD must be at least 12 characters.");
  }
  return raw;
}

function artifactConfig(args = {}) {
  const noteDir = path.resolve(rootDir, process.env.NOTE_DIR || process.env.PX402_NOTE_DIR || "data/notes");
  const receiptDir = path.resolve(rootDir, process.env.RECEIPT_DIR || "data/receipts");
  const responseDir = path.resolve(rootDir, process.env.RESPONSE_DIR || "data/responses");
  const command = args._?.[0] || "doctor";
  const runId = process.env.RUN_ID || args.runId || newRunId(command);
  const logDir = path.resolve(rootDir, process.env.RUN_LOG_DIR || "data/run-logs");
  return {
    args,
    runId,
    logDir,
    runLogPath: path.join(logDir, `${runId}.jsonl`),
    noteDir,
    receiptDir,
    responseDir,
    recoveryDir: path.resolve(rootDir, process.env.RECOVERY_DIR || "data/recovery"),
    cmcSymbol: args.symbol || process.env.CMC_SYMBOL || "ETH",
    exaQuery: args.query || process.env.EXA_QUERY || "Ethereum market structure and Base ecosystem catalyst",
    exaNumResults: Number(args.numResults || process.env.EXA_NUM_RESULTS || 3),
  };
}

function config(args = {}) {
  const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.PX402_PRIVATE_KEY);
  const account = accounts().privateKeyToAccount(privateKey);
  return {
    ...artifactConfig(args),
    privateKey,
    account,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    notePassword: requiredNotePassword(),
    remoteCircuitsAck: process.env.PRXVT_REMOTE_CIRCUITS_ACK || "",
    maxUsdPerCall: numberEnv("MAX_USD_PER_CALL", 0.02),
    monthlyBudgetUsd: numberEnv("MONTHLY_BUDGET_USD", 20),
    minNoteAgeMinutes: numberEnv("MIN_NOTE_AGE_MINUTES", 60),
    autoPrepareBeforePayment: toBool(process.env.AUTO_PREPARE_BEFORE_PAYMENT),
    burnerFundingBucketUsdc: numberEnv("BURNER_FUNDING_BUCKET_USD", 0),
    minBaseEthBuffer: process.env.MIN_BASE_ETH_BUFFER || "0.00005",
    zeroxApiKey: process.env.ZEROX_API_KEY || process.env["0X_API_KEY"],
    zeroxDustUsdc: numberEnv("ZEROX_DUST_USDC", 0.1),
  };
}

function publicClient(cfg) {
  const { createPublicClient, http } = viem();
  return createPublicClient({
    chain: chains().base,
    transport: http(cfg.rpcUrl),
  });
}

function walletClient(cfg) {
  const { createWalletClient, http } = viem();
  return createWalletClient({
    account: cfg.account,
    chain: chains().base,
    transport: http(cfg.rpcUrl),
  });
}

async function balances(cfg) {
  const client = publicClient(cfg);
  const [ethWei, usdcMicro] = await Promise.all([
    client.getBalance({ address: cfg.account.address }),
    client.readContract({
      address: BASE_USDC,
      abi: viem().erc20Abi,
      functionName: "balanceOf",
      args: [cfg.account.address],
    }),
  ]);
  return {
    address: cfg.account.address,
    baseEth: viem().formatEther(ethWei),
    baseEthWei: ethWei,
    baseUsdc: viem().formatUnits(usdcMicro, 6),
    baseUsdcMicro: usdcMicro,
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listNoteFiles(cfg) {
  if (!fs.existsSync(cfg.noteDir)) return [];
  return fs.readdirSync(cfg.noteDir)
    .filter((name) => name.endsWith(".json") && name.includes("px402-note"))
    .map((name) => path.join(cfg.noteDir, name))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.file);
}

async function readLatestNote(cfg) {
  const [file] = listNoteFiles(cfg);
  if (!file) return null;
  const { decryptNote, getNoteBalance } = privacy();
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  const note = await decryptNote(stored.encryptedNote, cfg.notePassword);
  const stat = fs.statSync(file);
  return {
    file,
    note,
    balance: getNoteBalance(note),
    createdAt: stored.createdAt || null,
    privacyReadyAt: stored.privacyReadyAt || stored.createdAt || null,
    mtimeMs: stat.mtimeMs,
  };
}

async function writeEncryptedNote(cfg, note, meta = {}) {
  const { encryptNote } = privacy();
  ensureDir(cfg.noteDir);
  const encryptedNote = await encryptNote(note, cfg.notePassword);
  const file = path.join(cfg.noteDir, `px402-note-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    chain: "base",
    createdAt: new Date().toISOString(),
    ...meta,
    encryptedNote,
  }, null, 2));
  return file;
}

function encryptLocalSecret(cfg, payload) {
  ensureDir(cfg.recoveryDir);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(cfg.notePassword, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const file = path.join(cfg.recoveryDir, `recovery-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }, null, 2));
  return file;
}

function decryptLocalSecret(cfg, file) {
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  if (stored.version !== 1) throw new Error(`Unsupported recovery file version: ${stored.version}`);
  const salt = Buffer.from(stored.salt, "base64");
  const iv = Buffer.from(stored.iv, "base64");
  const tag = Buffer.from(stored.tag, "base64");
  const ciphertext = Buffer.from(stored.ciphertext, "base64");
  const key = crypto.scryptSync(cfg.notePassword, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function resolveRecoveryFile(cfg, requested) {
  if (!requested) throw new Error("--file is required.");
  const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(rootDir, requested);
  const base = path.resolve(cfg.recoveryDir);
  if (!resolved.toLowerCase().startsWith(`${base.toLowerCase()}${path.sep}`)) {
    throw new Error(`Recovery file must be inside ${cfg.recoveryDir}.`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`Recovery file not found: ${resolved}`);
  return resolved;
}

function recoveryDestination(cfg, args) {
  const raw = args.destination || process.env.RECOVERY_SWEEP_DESTINATION || "";
  if (!raw) return null;
  if (!viem().isAddress(raw)) {
    throw new Error("--destination must be a valid EVM address.");
  }
  const destination = viem().getAddress(raw);
  if (destination.toLowerCase() === cfg.account.address.toLowerCase() && !args.allowLinkingSweep) {
    throw new Error("Refusing to recover directly to the configured hot wallet. This creates a public burner -> hot-wallet edge. Use an unlinkable destination/relayer, or pass --allow-linking-sweep for unsafe debugging only.");
  }
  return destination;
}

function mergeNotes(existing, deposited) {
  if (!existing) return deposited;
  return {
    version: existing.version || deposited.version || "2.0",
    commitments: [
      ...(existing.commitments || []),
      ...(deposited.commitments || []),
    ],
  };
}

function selectDepositAmount(shortfallUsdc) {
  const withBuffer = Math.max(shortfallUsdc, 0.01) + 0.002;
  const amount = ALLOWED_DEPOSITS.find((candidate) => candidate >= withBuffer);
  if (!amount) throw new Error(`Required note top-up is too large for this demo: ${shortfallUsdc} USDC.`);
  return amount;
}

async function ensureDustEth(cfg, dryRun = false) {
  const current = await balances(cfg);
  const minWei = BigInt(Math.ceil(Number(cfg.minBaseEthBuffer) * 1e18));
  if (current.baseEthWei >= minWei) {
    return { action: "skip_dust_eth", reason: "eth_buffer_sufficient", balances: current };
  }
  if (!cfg.zeroxApiKey) {
    throw new Error("Base ETH is below buffer and ZEROX_API_KEY/0X_API_KEY is missing.");
  }
  if (Number(current.baseUsdc) < cfg.zeroxDustUsdc) {
    throw new Error(`Need ${cfg.zeroxDustUsdc} USDC for 0x Gasless dust ETH, have ${current.baseUsdc}.`);
  }
  if (dryRun) {
    return { action: "would_buy_dust_eth", sellUsdc: cfg.zeroxDustUsdc, balances: current };
  }
  setupFetchTimeouts();
  return buyDustEth(cfg);
}

function splitSignature(signature) {
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  return {
    r: `0x${hex.slice(0, 64)}`,
    s: `0x${hex.slice(64, 128)}`,
    v: Number.parseInt(hex.slice(128, 130), 16),
    signatureType: 2,
  };
}

async function signTyped(wallet, eip712) {
  const types = { ...eip712.types };
  delete types.EIP712Domain;
  return wallet.signTypedData({
    domain: eip712.domain,
    types,
    primaryType: eip712.primaryType,
    message: eip712.message,
  });
}

async function buyDustEth(cfg) {
  setupFetchTimeouts();
  const sellAmount = BigInt(Math.floor(cfg.zeroxDustUsdc * 1_000_000)).toString();
  const url = new URL("https://api.0x.org/gasless/quote");
  url.searchParams.set("chainId", "8453");
  url.searchParams.set("sellToken", BASE_USDC);
  url.searchParams.set("buyToken", NATIVE_ETH);
  url.searchParams.set("sellAmount", sellAmount);
  url.searchParams.set("taker", cfg.account.address);

  const headers = {
    "0x-api-key": cfg.zeroxApiKey,
    "0x-version": "v2",
    "content-type": "application/json",
  };
  const quote = await fetchJson(url, { headers });
  if (!quote.ok) throw new Error(`0x Gasless quote failed: ${JSON.stringify(quote.body)}`);
  if (quote.body.issues?.balance) throw new Error(`0x reports insufficient balance: ${JSON.stringify(quote.body.issues.balance)}`);

  const wallet = walletClient(cfg);
  let approval = null;
  if (quote.body.issues?.allowance && quote.body.approval?.eip712) {
    approval = {
      type: quote.body.approval.type,
      eip712: quote.body.approval.eip712,
      signature: splitSignature(await signTyped(wallet, quote.body.approval.eip712)),
    };
  }
  const trade = {
    type: quote.body.trade.type,
    eip712: quote.body.trade.eip712,
    signature: splitSignature(await signTyped(wallet, quote.body.trade.eip712)),
  };
  const submit = await fetchJson("https://api.0x.org/gasless/submit", {
    method: "POST",
    headers,
    body: JSON.stringify({ chainId: 8453, ...(approval ? { approval } : {}), trade }),
  });
  if (!submit.ok || !submit.body.tradeHash) throw new Error(`0x Gasless submit failed: ${JSON.stringify(submit.body)}`);

  let finalStatus = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(3_000);
    const statusUrl = new URL(`https://api.0x.org/gasless/status/${submit.body.tradeHash}`);
    statusUrl.searchParams.set("chainId", "8453");
    const status = await fetchJson(statusUrl, { headers: { "0x-api-key": cfg.zeroxApiKey, "0x-version": "v2" } });
    finalStatus = status.body;
    if (["confirmed", "succeeded", "failed", "cancelled"].includes(finalStatus.status)) break;
  }
  return {
    action: "bought_dust_eth",
    sellUsdc: cfg.zeroxDustUsdc,
    tradeHash: submit.body.tradeHash,
    status: finalStatus?.status || "unknown",
    transactionHash: finalStatus?.transactionHash || finalStatus?.transactions?.[0]?.hash || null,
  };
}

async function ensureNoteBalance(cfg, requiredUsdc, dryRun = false) {
  const { PrivacySDK, getNoteBalance } = privacy();
  const existing = await readLatestNote(cfg);
  const existingBalance = existing?.balance || 0;
  if (existingBalance >= requiredUsdc) {
    return { action: "skip_deposit", reason: "note_balance_sufficient", note: existing };
  }
  const depositAmount = selectDepositAmount(requiredUsdc - existingBalance);
  const privacyReadyAt = notePrivacyReadyAt(cfg);
  if (dryRun) {
    return { action: "would_deposit", depositAmount, existingBalance, privacyReadyAt };
  }
  assertBaseOnlyConfig();
  assertRemoteCircuitsAccepted(cfg);
  await ensureDustEth(cfg, false);
  const sdk = new PrivacySDK({ chain: "base", rpcUrl: cfg.rpcUrl });
  const deposited = await sdk.depositFast(depositAmount, cfg.privateKey);
  const merged = mergeNotes(existing?.note, deposited);
  const noteFile = await writeEncryptedNote(cfg, merged, {
    source: "px402_deposit",
    depositAmountUsdc: depositAmount,
    previousNotePath: existing?.file || null,
    privacyReadyAt,
  });
  return {
    action: "deposited",
    depositAmount,
    note: { file: noteFile, note: merged, balance: getNoteBalance(merged), privacyReadyAt },
  };
}

async function fetchJson(input, init = {}) {
  setupFetchTimeouts();
  const response = await fetch(input, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { response, status: response.status, ok: response.ok, body, text };
}

function paymentRequiredBody(result) {
  const header = result.response.headers.get("payment-required");
  if (!header) return result.body;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return result.body;
  }
}

function selectBaseUsdcAccept(body) {
  const accepts = Array.isArray(body.accepts) ? body.accepts : [];
  const found = accepts.find((item) => {
    const network = String(item.network || "").toLowerCase();
    const asset = String(item.asset || "").toLowerCase();
    return item.scheme === "exact"
      && (network === "eip155:8453" || network === "base")
      && asset === BASE_USDC.toLowerCase();
  });
  if (!found) throw new Error("No Base USDC x402 payment option found.");
  const rawAmount = found.maxAmountRequired || found.amount;
  if (!rawAmount) throw new Error("Selected x402 accept item has no amount.");
  return { ...found, amountMicro: BigInt(rawAmount), priceUsdc: Number(rawAmount) / 1_000_000 };
}

function serializeAccept(accept) {
  const { amountMicro, priceUsdc, ...rest } = accept;
  return rest;
}

function assertBaseOnlyConfig() {
  const chain = String(process.env.X402_CHAIN || "base").toLowerCase();
  if (chain !== "base") {
    throw new Error("This adapter is Base-only. X402_CHAIN must be base.");
  }
}

function requestMethod(init = {}) {
  return String(init.method || "GET").toUpperCase();
}

function urlFromInput(input) {
  return new URL(String(input));
}

function assertUrlMatchesPolicy(url, policy, label) {
  if (url.origin !== policy.origin) {
    throw new Error(`${label} origin ${url.origin} is not allowlisted; expected ${policy.origin}.`);
  }
  if (!url.pathname.startsWith(policy.pathPrefix)) {
    throw new Error(`${label} path ${url.pathname} is not allowlisted; expected prefix ${policy.pathPrefix}.`);
  }
}

function assertProviderInvariant(provider, input, init = {}, probe = null) {
  const policy = PROVIDER_POLICIES[provider];
  if (!policy) throw new Error(`No x402 allowlist policy for provider: ${provider}.`);
  const method = requestMethod(init);
  if (method !== policy.method) {
    throw new Error(`${provider} method ${method} is not allowlisted; expected ${policy.method}.`);
  }
  const requestUrl = urlFromInput(input);
  assertUrlMatchesPolicy(requestUrl, policy, `${provider} request`);
  if (!probe) return;
  const resource = probe.body?.resource?.url || probe.accept?.resource;
  if (resource) {
    const resourceUrl = new URL(String(resource));
    assertUrlMatchesPolicy(resourceUrl, policy, `${provider} x402 resource`);
  }
}

function assertRemoteCircuitsAccepted(cfg) {
  if (cfg.remoteCircuitsAck !== REMOTE_CIRCUITS_ACK) {
    throw new Error(`PRXVT SDK downloads unpinned remote wasm/zkey files. For hackathon-only real spend, set PRXVT_REMOTE_CIRCUITS_ACK=${REMOTE_CIRCUITS_ACK}. For production, vendor and hash-pin circuits instead.`);
  }
}

function notePrivacyReadyAt(cfg) {
  return new Date(Date.now() + cfg.minNoteAgeMinutes * 60_000).toISOString();
}

function assertNotePrivacyReady(cfg, latest) {
  if (cfg.args.allowFreshNote || cfg.minNoteAgeMinutes <= 0) return;
  const readyAtRaw = latest?.privacyReadyAt || latest?.createdAt;
  const readyAtMs = readyAtRaw ? Date.parse(readyAtRaw) : latest?.mtimeMs;
  if (!Number.isFinite(readyAtMs)) return;
  if (Date.now() < readyAtMs) {
    throw new Error(`Latest note is not privacy-ready until ${new Date(readyAtMs).toISOString()}. Waiting decouples deposit timing from provider payment. Use --allow-fresh-note only for unsafe demos.`);
  }
}

function burnerFundingUsdc(cfg, priceUsdc) {
  if (priceUsdc <= 0) return 0;
  const bucket = Number(cfg.burnerFundingBucketUsdc || 0);
  if (bucket <= 0) return priceUsdc;
  if (bucket < priceUsdc) {
    throw new Error(`BURNER_FUNDING_BUCKET_USD ${bucket} is below x402 price ${priceUsdc}.`);
  }
  return bucket;
}

function requiredFundingUsdc(cfg, priceUsdc) {
  return burnerFundingUsdc(cfg, priceUsdc);
}

async function probePayment(input, init) {
  const first = await fetchJson(input, init);
  if (first.status !== 402) {
    return { status: first.status, alreadyFree: true, body: first.body };
  }
  const body = paymentRequiredBody(first);
  const accept = selectBaseUsdcAccept(body);
  return { status: 402, x402Version: body.x402Version || 1, accept, body };
}

function assertBudget(cfg, provider, priceUsdc) {
  if (priceUsdc > cfg.maxUsdPerCall) {
    throw new Error(`${provider} price ${priceUsdc} exceeds MAX_USD_PER_CALL ${cfg.maxUsdPerCall}.`);
  }
  const spent = monthlySpent(cfg);
  if (spent + priceUsdc > cfg.monthlyBudgetUsd) {
    throw new Error(`Monthly budget exceeded: ${spent} + ${priceUsdc} > ${cfg.monthlyBudgetUsd}.`);
  }
}

function monthlySpent(cfg) {
  if (!fs.existsSync(cfg.receiptDir)) return 0;
  const prefix = new Date().toISOString().slice(0, 7);
  return fs.readdirSync(cfg.receiptDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(cfg.receiptDir, name))
    .reduce((sum, file) => {
      try {
        const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
        if (String(receipt.createdAt || "").startsWith(prefix)) {
          return sum + Number(receipt.priceUsdc || 0);
        }
      } catch {}
      return sum;
    }, 0);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function privateX402Call(cfg, provider, input, init = {}, dryRun = false) {
  const callStart = Date.now();
  appendRunLog(cfg, {
    event: "x402_call_start",
    provider,
    dryRun,
    input: String(input),
    method: requestMethod(init),
    requestHash: sha256(JSON.stringify({ input: String(input), init: { ...init, headers: init.headers || {} } })),
  });
  await timedStage(cfg, "policy_precheck", async () => {
    assertBaseOnlyConfig();
    assertProviderInvariant(provider, input, init);
  }, { provider });
  const probe = await timedStage(cfg, "probe_payment", () => probePayment(input, init), { provider });
  await timedStage(cfg, "policy_challenge_check", async () => {
    assertProviderInvariant(provider, input, init, probe);
  }, { provider });
  if (probe.status !== 402) {
    appendRunLog(cfg, { event: "x402_call_end", provider, paid: false, status: probe.status, elapsedMs: Date.now() - callStart });
    return { provider, status: probe.status, body: probe.body, paid: false, priceUsdc: 0 };
  }
  await timedStage(cfg, "budget_check", async () => {
    assertBudget(cfg, provider, probe.accept.priceUsdc);
  }, { provider, priceUsdc: probe.accept.priceUsdc });
  if (dryRun) {
    appendRunLog(cfg, {
      event: "x402_call_end",
      provider,
      dryRun: true,
      priceUsdc: probe.accept.priceUsdc,
      burnerFundUsdc: burnerFundingUsdc(cfg, probe.accept.priceUsdc),
      network: probe.accept.network,
      payTo: probe.accept.payTo,
      elapsedMs: Date.now() - callStart,
    });
    return {
      provider,
      dryRun: true,
      x402Version: probe.x402Version,
      priceUsdc: probe.accept.priceUsdc,
      burnerFundUsdc: burnerFundingUsdc(cfg, probe.accept.priceUsdc),
      network: probe.accept.network,
      payTo: probe.accept.payTo,
      resource: probe.body.resource?.url || probe.accept.resource || String(input),
    };
  }

  const latest = await timedStage(cfg, "read_latest_note", () => readLatestNote(cfg), { provider });
  const burnerFundUsdc = burnerFundingUsdc(cfg, probe.accept.priceUsdc);
  if (!latest || latest.balance < burnerFundUsdc) {
    throw new Error(`Insufficient px402 note balance for ${provider}. Run prepare first.`);
  }
  assertNotePrivacyReady(cfg, latest);
  assertRemoteCircuitsAccepted(cfg);

  const { PrivacySDK, getNoteBalance } = privacy();
  const sdk = new PrivacySDK({ chain: "base", rpcUrl: cfg.rpcUrl });
  sdk.setNote(latest.note);
  const paymentResult = await timedStage(cfg, "private_note_make_payment", () => sdk.makePayment(latest.note, "", burnerFundUsdc), {
    provider,
    priceUsdc: probe.accept.priceUsdc,
    burnerFundUsdc,
    sourceNotePath: relativeOrValue(latest.file),
    noteBalanceBeforeUsdc: latest.balance,
  });
  const burner = accounts().privateKeyToAccount(paymentResult.burnerPrivateKey);
  appendRunLog(cfg, {
    event: "payment_made",
    provider,
    payer: burner.address,
    paymentTx: paymentResult.txHash,
    priceUsdc: probe.accept.priceUsdc,
    burnerFundUsdc,
  });
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
  const amountMicro = probe.accept.amountMicro;
  const burnerFundMicro = BigInt(Math.ceil(burnerFundUsdc * 1_000_000));
  const chainId = String(probe.accept.network).startsWith("eip155:")
    ? Number(String(probe.accept.network).split(":")[1])
    : 8453;
  const domain = {
    name: probe.accept.extra?.name || "USD Coin",
    version: probe.accept.extra?.version || "2",
    chainId,
    verifyingContract: probe.accept.asset,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: burner.address,
    to: probe.accept.payTo,
    value: amountMicro,
    validAfter,
    validBefore,
    nonce,
  };
  const signature = await burner.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const authorization = {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
  };
  const paymentPayload = probe.x402Version >= 2
    ? {
        x402Version: probe.x402Version,
        scheme: probe.accept.scheme,
        network: probe.accept.network,
        resource: probe.body.resource,
        accepted: serializeAccept(probe.accept),
        payload: { signature, authorization },
      }
    : {
        x402Version: probe.x402Version,
        scheme: "exact",
        network: probe.accept.network,
        payload: { signature, authorization },
      };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  const recoveryPath = await timedStage(cfg, "write_recovery_secret", async () => encryptLocalSecret(cfg, {
    provider,
    createdAt: new Date().toISOString(),
    burnerPrivateKey: paymentResult.burnerPrivateKey,
    burnerAddress: burner.address,
    paymentTx: paymentResult.txHash,
    intendedPayTo: probe.accept.payTo,
    intendedAmountMicro: burnerFundMicro.toString(),
    providerAmountMicro: amountMicro.toString(),
    burnerFundUsdc,
  }), { provider, payer: burner.address });
  appendRunLog(cfg, { event: "recovery_written", provider, recoveryPath: relativeOrValue(recoveryPath) });

  const retryInit = {
    ...init,
    headers: {
      ...(init.headers || {}),
      "PAYMENT-SIGNATURE": paymentHeader,
      "X-PAYMENT": paymentHeader,
    },
  };
  const paid = await timedStage(cfg, "retry_fetch_with_payment", () => fetchJson(input, retryInit), { provider });
  appendRunLog(cfg, { event: "paid_response_received", provider, status: paid.status, ok: paid.ok });
  const responsePath = await timedStage(cfg, "write_response_body", async () => writeResponseBody(cfg, provider, paid.text), { provider });
  const updatedNote = sdk.getUpdatedNote();
  const updatedNotePath = updatedNote
    ? await timedStage(cfg, "write_updated_note", () => writeEncryptedNote(cfg, updatedNote, { source: "private_x402_payment", provider, previousNotePath: latest.file, privacyReadyAt: latest.privacyReadyAt || latest.createdAt || null }), { provider })
    : null;
  const receiptPayload = {
    provider,
    createdAt: new Date().toISOString(),
    status: paid.status,
    priceUsdc: probe.accept.priceUsdc,
    x402Version: probe.x402Version,
    network: probe.accept.network,
    asset: probe.accept.asset,
    payTo: probe.accept.payTo,
    payer: burner.address,
    paymentTx: paymentResult.txHash,
    burnerFundUsdc,
    burnerRemainderUsdc: burnerFundUsdc - probe.accept.priceUsdc,
    xPaymentResponse: paid.response.headers.get("x-payment-response"),
    paymentResponse: paid.response.headers.get("payment-response"),
    requestHash: sha256(JSON.stringify({ input: String(input), init: { ...init, headers: init.headers || {} } })),
    responseHash: sha256(paid.text),
    responsePath,
    noteBalanceBeforeUsdc: latest.balance,
    noteBalanceAfterUsdc: updatedNote ? getNoteBalance(updatedNote) : null,
    sourceNotePath: latest.file,
    updatedNotePath,
    recoveryPath,
    runId: cfg.runId,
    runLogPath: cfg.runLogPath,
  };
  const receiptPath = await timedStage(cfg, "write_receipt", async () => writeReceipt(cfg, receiptPayload), { provider });
  appendRunLog(cfg, {
    event: "x402_call_end",
    provider,
    paid: true,
    status: paid.status,
    priceUsdc: probe.accept.priceUsdc,
    burnerFundUsdc,
    receiptPath: relativeOrValue(receiptPath),
    responsePath: relativeOrValue(responsePath),
    updatedNotePath: relativeOrValue(updatedNotePath),
    recoveryPath: relativeOrValue(recoveryPath),
    noteBalanceBeforeUsdc: latest.balance,
    noteBalanceAfterUsdc: receiptPayload.noteBalanceAfterUsdc,
    elapsedMs: Date.now() - callStart,
  });
  return {
    provider,
    status: paid.status,
    body: paid.body,
    text: paid.text,
    paid: true,
    priceUsdc: probe.accept.priceUsdc,
    burnerFundUsdc,
    receiptPath,
    updatedNotePath,
    responsePath,
    recoveryPath,
    xPaymentResponse: paid.response.headers.get("x-payment-response"),
    paymentResponse: paid.response.headers.get("payment-response"),
  };
}

function writeReceipt(cfg, receipt) {
  ensureDir(cfg.receiptDir);
  const file = path.join(cfg.receiptDir, `receipt-${Date.now()}-${receipt.provider}.json`);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  return file;
}

function writeResponseBody(cfg, provider, text) {
  ensureDir(cfg.responseDir);
  const file = path.join(cfg.responseDir, `response-${Date.now()}-${provider}.json`);
  fs.writeFileSync(file, text);
  return file;
}

function latestDataFile(dir, provider, prefix) {
  if (!fs.existsSync(dir)) return null;
  const match = `-${provider}.json`;
  const [entry] = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(match))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entry?.file || null;
}

function readJsonFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cmcRequest(cfg) {
  const url = new URL(process.env.CMC_X402_URL || DEFAULT_CMC_URL);
  url.searchParams.set("symbol", cfg.cmcSymbol);
  return { input: url, init: { method: "GET" } };
}

function exaRequest(cfg) {
  return {
    input: process.env.EXA_X402_URL || DEFAULT_EXA_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: cfg.exaQuery,
        numResults: cfg.exaNumResults,
        type: "auto",
      }),
    },
  };
}

function nansenNetflowRequest() {
  return {
    input: "https://api.nansen.ai/api/v1/smart-money/netflow",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chains: ["ethereum", "solana"],
        filters: {
          include_smart_money_labels: ["Fund", "Smart Trader"],
          exclude_smart_money_labels: ["30D Smart Trader"],
          include_stablecoins: false,
          include_native_tokens: false,
        },
        order_by: [
          { field: "net_flow_24h_usd", direction: "DESC" },
        ],
        pagination: { page: 1, per_page: 10 },
      }),
    },
  };
}

function nansenHoldingsRequest() {
  return {
    input: "https://api.nansen.ai/api/v1/smart-money/holdings",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chains: ["ethereum", "solana"],
        filters: {
          include_smart_money_labels: ["Fund", "Smart Trader"],
          exclude_smart_money_labels: ["30D Smart Trader"],
          include_stablecoins: false,
          include_native_tokens: false,
          token_age_days: { max: 30 },
          value_usd: { min: 1000, max: 100000 },
          balance_24h_percent_change: { min: -0.1, max: 0.1 },
        },
        order_by: [
          { field: "value_usd", direction: "DESC" },
        ],
        pagination: { page: 1, per_page: 10 },
      }),
    },
  };
}

function nansenPerpTradesRequest() {
  return {
    input: "https://api.nansen.ai/api/v1/smart-money/perp-trades",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        only_new_positions: true,
        filters: {
          token_symbol: "BTC",
          side: "Long",
          action: "Buy - Add Long",
          value_usd: { min: 1000, max: 10000 },
        },
        order_by: [
          { field: "block_timestamp", direction: "DESC" },
        ],
        pagination: { page: 1, per_page: 10 },
      }),
    },
  };
}

function summarizeSignal(cfg, cmc, exa) {
  const rawData = cmc.body?.data || {};
  const candidates = Array.isArray(rawData) ? rawData : Object.values(rawData);
  const first = candidates.find((item) => item?.symbol === cfg.cmcSymbol && item?.is_active === 1)
    || candidates.find((item) => item?.symbol === cfg.cmcSymbol)
    || candidates[0]
    || {};
  const quoteRaw = first.quote || {};
  const quote = Array.isArray(quoteRaw)
    ? quoteRaw.find((item) => item?.symbol === "USD") || quoteRaw[0] || {}
    : quoteRaw.USD || {};
  const results = Array.isArray(exa.body?.results) ? exa.body.results : [];
  const change24h = Number(quote.percent_change_24h ?? 0);
  const evidenceCount = results.length;
  const decision = evidenceCount === 0
    ? "needs_more_evidence"
    : Math.abs(change24h) > 5
      ? "monitor"
      : "needs_more_evidence";
  return {
    symbol: cfg.cmcSymbol,
    priceUsd: quote.price ?? null,
    volume24h: quote.volume_24h ?? null,
    percentChange24h: quote.percent_change_24h ?? null,
    marketCap: quote.market_cap ?? null,
    evidence: results.slice(0, 3).map((item) => ({
      title: item.title,
      url: item.url,
      score: item.score,
    })),
    decision,
    privacyBoundary: "research payment note/burner is separate from any future trading wallet",
  };
}

async function commandDoctor(cfg) {
  const latest = await readLatestNote(cfg);
  const bal = await balances(cfg);
  printJson({
    action: "doctor",
    wallet: bal.address,
    baseEth: bal.baseEth,
    baseUsdc: bal.baseUsdc,
    noteDir: cfg.noteDir,
    receiptDir: cfg.receiptDir,
    responseDir: cfg.responseDir,
    recoveryDir: cfg.recoveryDir,
    latestNotePath: latest?.file || null,
    latestNoteBalanceUsdc: latest?.balance || 0,
    zeroxConfigured: Boolean(cfg.zeroxApiKey),
    maxUsdPerCall: cfg.maxUsdPerCall,
    monthlyBudgetUsd: cfg.monthlyBudgetUsd,
    monthlySpentUsd: monthlySpent(cfg),
    minNoteAgeMinutes: cfg.minNoteAgeMinutes,
    autoPrepareBeforePayment: cfg.autoPrepareBeforePayment,
    burnerFundingBucketUsdc: cfg.burnerFundingBucketUsdc,
  });
}

async function commandPrepare(cfg, args) {
  const dryRun = Boolean(args.dryRun);
  appendRunLog(cfg, { event: "command_prepare_start", dryRun });
  const dust = await timedStage(cfg, "ensure_dust_eth", () => ensureDustEth(cfg, dryRun), { dryRun });
  const note = await timedStage(cfg, "ensure_note_balance", () => ensureNoteBalance(cfg, numberEnv("REQUIRED_NOTE_BALANCE_USD", 0.03), dryRun), { dryRun });
  printJson({ action: "prepare", dryRun, dust, note: publicNoteSummary(note) });
  appendRunLog(cfg, { event: "command_prepare_end", dryRun, dustAction: dust.action, noteAction: note.action });
}

async function commandMarket(cfg, args) {
  const dryRun = Boolean(args.dryRun);
  const providers = String(args.providers || "cmc,exa").split(",").map((item) => item.trim()).filter(Boolean);
  const cmcReq = cmcRequest(cfg);
  const exaReq = exaRequest(cfg);
  for (const provider of providers) {
    if (!PROVIDER_POLICIES[provider]) throw new Error(`Unknown or unallowlisted provider: ${provider}.`);
  }
  if (providers.includes("cmc")) assertProviderInvariant("cmc", cmcReq.input, cmcReq.init);
  if (providers.includes("exa")) assertProviderInvariant("exa", exaReq.input, exaReq.init);
  const cmcProbe = providers.includes("cmc") ? await probePayment(cmcReq.input, cmcReq.init) : null;
  const exaProbe = providers.includes("exa") ? await probePayment(exaReq.input, exaReq.init) : null;
  const requiredUsdc = requiredFundingUsdc(cfg, cmcProbe?.accept?.priceUsdc || 0)
    + requiredFundingUsdc(cfg, exaProbe?.accept?.priceUsdc || 0)
    + 0.003;
  if (dryRun) {
    printJson({
      action: "market_dry_run",
      requiredUsdc,
      providers,
      cmc: providers.includes("cmc") ? await privateX402Call(cfg, "cmc", cmcReq.input, cmcReq.init, true) : null,
      exa: providers.includes("exa") ? await privateX402Call(cfg, "exa", exaReq.input, exaReq.init, true) : null,
    });
    return;
  }
  await ensureDustEth(cfg, false);
  const latest = await readLatestNote(cfg);
  if (!latest || latest.balance < requiredUsdc) {
    if (!(args.autoPrepare || cfg.autoPrepareBeforePayment)) {
      throw new Error(`Insufficient privacy-ready note balance for market call. Run npm run privacy -- prepare first, wait until privacyReadyAt, then rerun market. Use --auto-prepare --allow-fresh-note only for unsafe demos.`);
    }
    await ensureNoteBalance(cfg, requiredUsdc, false);
  }
  const cmc = providers.includes("cmc") ? await privateX402Call(cfg, "cmc", cmcReq.input, cmcReq.init, false) : { body: {} };
  if (providers.includes("cmc") && (cmc.status < 200 || cmc.status >= 300)) {
    throw new Error(`CMC private x402 call returned HTTP ${cmc.status}; see ${cmc.receiptPath}`);
  }
  const exa = providers.includes("exa") ? await privateX402Call(cfg, "exa", exaReq.input, exaReq.init, false) : { body: {} };
  if (providers.includes("exa") && (exa.status < 200 || exa.status >= 300)) {
    throw new Error(`Exa private x402 call returned HTTP ${exa.status}; see ${exa.receiptPath}`);
  }
  const signal = summarizeSignal(cfg, cmc, exa);
  const signalPath = path.join(cfg.receiptDir, `market-signal-${Date.now()}.json`);
  ensureDir(cfg.receiptDir);
  fs.writeFileSync(signalPath, JSON.stringify({ createdAt: new Date().toISOString(), signal, cmcReceipt: cmc.receiptPath, exaReceipt: exa.receiptPath }, null, 2));
  printJson({
    action: "market_complete",
    providers,
    signal,
    signalPath,
    cmc: providers.includes("cmc") ? { status: cmc.status, priceUsdc: cmc.priceUsdc, receiptPath: cmc.receiptPath } : null,
    exa: providers.includes("exa") ? { status: exa.status, priceUsdc: exa.priceUsdc, receiptPath: exa.receiptPath } : null,
  });
  scheduleForceExit();
}

async function commandSummarize(cfg, args) {
  const cmcFile = args.cmcResponse || latestDataFile(cfg.responseDir, "cmc", "response-");
  const exaFile = args.exaResponse || latestDataFile(cfg.responseDir, "exa", "response-");
  const cmc = { body: readJsonFile(cmcFile) };
  const exaBody = exaFile ? readJsonFile(exaFile) : {};
  const exa = { body: Array.isArray(exaBody.results) ? exaBody : {} };
  const signal = summarizeSignal(cfg, cmc, exa);
  const hasSourceFiles = Boolean(cmcFile || exaFile);
  const signalPath = hasSourceFiles ? path.join(cfg.receiptDir, `market-signal-${Date.now()}.json`) : null;
  if (signalPath) {
    ensureDir(cfg.receiptDir);
    fs.writeFileSync(signalPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      signal,
      cmcResponse: cmcFile,
      exaResponse: exaFile,
    }, null, 2));
  }
  printJson({ action: "summarize", signal, signalPath, cmcResponse: cmcFile, exaResponse: exaFile });
}

async function commandRecoverList(cfg) {
  const files = fs.existsSync(cfg.recoveryDir)
    ? fs.readdirSync(cfg.recoveryDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(cfg.recoveryDir, name);
        const stat = fs.statSync(file);
        return { file, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
    : [];
  printJson({ action: "recover_list", recoveryDir: cfg.recoveryDir, files });
}

async function commandRecoverSweep(cfg, args) {
  const file = resolveRecoveryFile(cfg, args.file);
  const recovery = decryptLocalSecret(cfg, file);
  const burner = accounts().privateKeyToAccount(recovery.burnerPrivateKey);
  const destination = recoveryDestination(cfg, args);
  const client = publicClient(cfg);
  const balance = await client.readContract({
    address: BASE_USDC,
    abi: viem().erc20Abi,
    functionName: "balanceOf",
    args: [burner.address],
  });
  const intended = BigInt(recovery.intendedAmountMicro || 0);
  const amount = balance < intended || intended === 0n ? balance : intended;
  const signOnly = Boolean(args.signOnly);
  const dryRun = !args.execute && !signOnly;
  if (amount === 0n || dryRun) {
    printJson({
      action: "recover_sweep",
      dryRun,
      signOnly,
      file,
      provider: recovery.provider,
      burnerAddress: burner.address,
      destination,
      destinationRequiredForSignOnly: !destination,
      balanceUsdc: viem().formatUnits(balance, 6),
      sweepAmountUsdc: viem().formatUnits(amount, 6),
      executable: false,
      signable: amount > 0n && Boolean(destination),
      privacyMode: "default_no_broadcast",
      warning: LINKING_SWEEP_WARNING,
      recommendedNext: "Use --sign-only --destination <unlinkable_address>, then broadcast the authorization from an unlinkable relayer/gas wallet.",
    });
    return;
  }
  if (!destination) {
    throw new Error("--destination is required for recovery. Do not recover to the configured hot wallet unless you explicitly accept the linkage risk.");
  }

  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
  const signature = await burner.signTypedData({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: BASE_USDC,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: burner.address,
      to: destination,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    },
  });
  const parts = splitSignature(signature);
  const authorization = {
    token: BASE_USDC,
    chainId: 8453,
    from: burner.address,
    to: destination,
    value: amount.toString(),
    valueUsdc: viem().formatUnits(amount, 6),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    signature,
    v: parts.v,
    r: parts.r,
    s: parts.s,
  };
  if (signOnly) {
    ensureDir(cfg.recoveryDir);
    const authorizationPath = path.join(cfg.recoveryDir, `recovery-authorization-${Date.now()}.json`);
    fs.writeFileSync(authorizationPath, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      sourceRecoveryPath: file,
      provider: recovery.provider,
      privacyMode: "sign_only_no_hot_wallet_broadcast",
      warning: LINKING_SWEEP_WARNING,
      broadcastInstruction: "Submit transferWithAuthorization from an unlinkable relayer/gas wallet. Do not broadcast from the configured research hot wallet.",
      authorization,
    }, null, 2));
    printJson({
      action: "recover_sweep",
      dryRun: false,
      signOnly: true,
      file,
      provider: recovery.provider,
      burnerAddress: burner.address,
      destination,
      amountUsdc: viem().formatUnits(amount, 6),
      authorizationPath,
      broadcastInstruction: "Use an unlinkable relayer/gas wallet. Broadcasting from the configured hot wallet defeats the recovery privacy boundary.",
    });
    return;
  }
  if (!args.allowLinkingSweep) {
    throw new Error("Refusing to broadcast recovery from the configured hot wallet. This links tx.from hot wallet to the burner authorization. Use --sign-only with an unlinkable relayer, or pass --allow-linking-sweep for unsafe debugging only.");
  }
  const hash = await walletClient(cfg).writeContract({
    address: BASE_USDC,
    abi: USDC_EIP3009_ABI,
    functionName: "transferWithAuthorization",
    args: [burner.address, destination, amount, validAfter, validBefore, nonce, parts.v, parts.r, parts.s],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const receiptPath = writeReceipt(cfg, {
    provider: "recovery_sweep",
    createdAt: new Date().toISOString(),
    status: receipt.status,
    priceUsdc: 0,
    sourceRecoveryPath: file,
    recoveredProvider: recovery.provider,
    burnerAddress: burner.address,
    destination,
    amountUsdc: viem().formatUnits(amount, 6),
    transactionHash: hash,
    privacyWarning: LINKING_SWEEP_WARNING,
  });
  printJson({
    action: "recover_sweep",
    dryRun: false,
    unsafeLinkingSweep: true,
    status: receipt.status,
    file,
    provider: recovery.provider,
    burnerAddress: burner.address,
    destination,
    amountUsdc: viem().formatUnits(amount, 6),
    transactionHash: hash,
    receiptPath,
    warning: LINKING_SWEEP_WARNING,
  });
  scheduleForceExit();
}

async function commandSmokeWeather(cfg, args) {
  const dryRun = Boolean(args.dryRun);
  const requiredUsdc = requiredFundingUsdc(cfg, 0.003);
  if (!dryRun) {
    await ensureDustEth(cfg, false);
    const latest = await readLatestNote(cfg);
    if (!latest || latest.balance < requiredUsdc) {
      if (!(args.autoPrepare || cfg.autoPrepareBeforePayment)) {
        throw new Error("Insufficient privacy-ready note balance for smoke:weather. Run prepare first and wait until privacyReadyAt, or use --auto-prepare --allow-fresh-note only for unsafe demos.");
      }
      await ensureNoteBalance(cfg, requiredUsdc, false);
    }
  }
  const result = await privateX402Call(cfg, "weather", process.env.X402_WEATHER_URL || DEFAULT_WEATHER_URL, { method: "GET" }, dryRun);
  printJson({ action: "smoke_weather", dryRun, result });
  if (!dryRun) scheduleForceExit();
}

async function commandNansen(cfg, args) {
  const dryRun = Boolean(args.dryRun);
  const dataset = String(args.dataset || "netflow");
  const datasets = {
    netflow: { provider: "nansen_netflow", request: nansenNetflowRequest() },
    holdings: { provider: "nansen_holdings", request: nansenHoldingsRequest() },
    "perp-trades": { provider: "nansen_perp_trades", request: nansenPerpTradesRequest() },
  };
  const selected = datasets[dataset];
  if (!selected) throw new Error(`Unknown Nansen dataset: ${dataset}. Use netflow, holdings, or perp-trades.`);
  appendRunLog(cfg, { event: "command_nansen_start", dataset, dryRun, provider: selected.provider });
  const probe = await timedStage(cfg, "nansen_initial_probe", () => probePayment(selected.request.input, selected.request.init), { dataset, provider: selected.provider });
  const requiredUsdc = requiredFundingUsdc(cfg, probe?.accept?.priceUsdc || 0) + numberEnv("PAYMENT_NOTE_BUFFER_USD", 0.003);
  if (!dryRun) {
    await timedStage(cfg, "ensure_dust_eth", () => ensureDustEth(cfg, false), { dataset, provider: selected.provider });
    const latest = await timedStage(cfg, "read_latest_note", () => readLatestNote(cfg), { dataset, provider: selected.provider });
    if (!latest || latest.balance < requiredUsdc) {
      if (!(args.autoPrepare || cfg.autoPrepareBeforePayment)) {
        throw new Error("Insufficient privacy-ready note balance for Nansen call. Run prepare first and wait until privacyReadyAt, or use --auto-prepare --allow-fresh-note only for unsafe demos.");
      }
      await timedStage(cfg, "ensure_note_balance", () => ensureNoteBalance(cfg, requiredUsdc, false), { dataset, provider: selected.provider, requiredUsdc });
    }
  }
  const result = await privateX402Call(cfg, selected.provider, selected.request.input, selected.request.init, dryRun);
  printJson({
    action: "nansen_research",
    runId: cfg.runId,
    runLogPath: cfg.runLogPath,
    dataset,
    dryRun,
    result: dryRun
      ? result
      : {
          provider: result.provider,
          status: result.status,
          priceUsdc: result.priceUsdc,
          receiptPath: result.receiptPath,
          responsePath: result.responsePath,
        },
  });
  appendRunLog(cfg, {
    event: "command_nansen_end",
    dataset,
    dryRun,
    provider: selected.provider,
    status: result.status,
    priceUsdc: result.priceUsdc,
    receiptPath: relativeOrValue(result.receiptPath),
    responsePath: relativeOrValue(result.responsePath),
  });
  if (!dryRun) scheduleForceExit();
}

async function commandInit(args) {
  const envPath = path.join(rootDir, ".env");
  if (fs.existsSync(envPath) && !args.force) {
    throw new Error(".env already exists. Refusing to overwrite it. Use --force only if you have backed it up.");
  }
  fs.writeFileSync(envPath, localEnvTemplate(args), { encoding: "utf8", flag: "w" });
  const hasPrivateKey = Boolean(process.env.PRIVATE_KEY || process.env.PX402_PRIVATE_KEY);
  printJson({
    action: "init",
    envPath,
    generatedNotePassword: true,
    privateKeyWrittenFromEnvironment: hasPrivateKey,
    unpinnedRemoteCircuitsAckWritten: Boolean(args.allowUnpinnedCircuits),
    next: hasPrivateKey
      ? "Run npm run privacy -- doctor."
      : "Fill PRIVATE_KEY locally or provide PRIVATE_KEY in the process environment before wallet commands.",
  });
}

function scheduleForceExit() {
  setTimeout(() => process.exit(0), 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  console.log(`Usage:
  npm run privacy -- init [--allow-unpinned-circuits] [--force]
  npm run privacy -- doctor
  npm run privacy -- prepare [--dry-run]
  npm run demo:market -- --symbol ETH --query "Ethereum market structure" [--dry-run]
  npm run privacy -- summarize [--cmc-response data/responses/response-...-cmc.json]
  npm run privacy -- recover:list
  npm run privacy -- recover:sweep --file data/recovery/recovery-....json
  npm run privacy -- recover:sweep --file data/recovery/recovery-....json --destination 0x... --sign-only
  npm run privacy -- smoke:weather [--dry-run]
  npm run privacy -- nansen [--dataset netflow|holdings|perp-trades] [--dry-run]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "doctor";
  if (command === "help" || command === "--help") {
    usage();
    return;
  }
  if (command === "init") return commandInit(args);
  if (command === "summarize") return commandSummarize(artifactConfig(args), args);
  const walletCommands = new Set(["doctor", "prepare", "market", "recover:list", "recover:sweep", "smoke:weather", "nansen"]);
  if (!walletCommands.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const cfg = config(args);
  appendRunLog(cfg, {
    event: "command_start",
    command,
    args: { ...args, _: args._ },
    dirs: {
      noteDir: relativeOrValue(cfg.noteDir),
      receiptDir: relativeOrValue(cfg.receiptDir),
      responseDir: relativeOrValue(cfg.responseDir),
      recoveryDir: relativeOrValue(cfg.recoveryDir),
      runLogPath: relativeOrValue(cfg.runLogPath),
    },
  });
  if (command === "doctor") return commandDoctor(cfg);
  if (command === "prepare") return commandPrepare(cfg, args);
  if (command === "market") return commandMarket(cfg, args);
  if (command === "recover:list") return commandRecoverList(cfg);
  if (command === "recover:sweep") return commandRecoverSweep(cfg, args);
  if (command === "smoke:weather") return commandSmokeWeather(cfg, args);
  if (command === "nansen") return commandNansen(cfg, args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  try {
    const args = parseArgs(process.argv.slice(2));
    const command = args._?.[0] || "unknown";
    const runId = process.env.RUN_ID || args.runId || "startup-error";
    const logDir = path.resolve(rootDir, process.env.RUN_LOG_DIR || "data/run-logs");
    appendRunLog({ runId, runLogPath: path.join(logDir, `${runId}.jsonl`) }, {
      event: "command_error",
      command,
      error: { name: error.name, message: error.message, stack: error.stack },
    });
  } catch {}
  printError({ action: "error", message: error.message });
  process.exit(1);
});
