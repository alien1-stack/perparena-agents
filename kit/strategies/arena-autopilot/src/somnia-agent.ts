// Somnia Agents: on-chain AI risk officer.
//
// Sends the proposed carry book to Somnia's LLM Inference agent (Qwen3-30B,
// run deterministically by a validator subcommittee) on Somnia SHANNON testnet
// and waits for the consensus answer. Everything here follows the official
// docs (docs.somnia.network/agents) and the Agent Explorer web app:
//   - platform contract SomniaAgents.createRequest(agentId, callback, selector, payload)
//   - agent id read from the on-chain AgentRegistry (getAllAgents/getAgent)
//   - payload = ABI-encoded inferString(prompt, system, chainOfThought, allowedValues)
//   - deposit = getRequestDeposit() + defaultSubcommitteeSize * 0.07 STT (LLM price);
//     unspent funds are rebated to the requester
//   - EOA invocation uses callback 0x0 / selector 0x00000000, like the web app
//   - result = RequestFinalized event; the finalizing tx is the validator's
//     submitResponse(requestId, result, ...) whose `result` is the ABI-encoded
//     consensus string (finalized requests are deleted, so getRequest reverts
//     RequestNotFound). The receipts service is the fallback.

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const SHANNON = {
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  blockExplorers: { default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" } },
} as const;

export const SOMNIA_AGENTS = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as const;
export const AGENT_REGISTRY = "0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A" as const;
/** "LLM Inference" in the testnet AgentRegistry (metadata: agents/llm-inference/*.json). */
export const LLM_INFERENCE_AGENT_ID = 12847293847561029384n;
/** Per-agent price for llm-inference (docs: Gas Fees). */
const LLM_PRICE_PER_AGENT = parseEther("0.07");
const RECEIPTS_URL = "https://receipts.testnet.agents.somnia.host";
const AGENTS_UI = "https://agents.testnet.somnia.network";

const STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

// Subset of SOMNIA_AGENTS_ABI as shipped by the Agent Explorer web app.
const platformAbi = [
  {
    type: "function",
    name: "createRequest",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "callbackAddress", type: "address" },
      { name: "callbackSelector", type: "bytes4" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  { type: "function", name: "getRequestDeposit", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "defaultSubcommitteeSize", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    // Called by subcommittee validators; the call that reaches the threshold finalizes.
    type: "function",
    name: "submitResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "result", type: "bytes" },
      { name: "receipt", type: "uint256" },
      { name: "success", type: "bool" },
      { name: "executionCost", type: "uint256" },
    ],
    outputs: [{ name: "gasCost", type: "uint256" }],
  },
  {
    type: "event",
    name: "RequestCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "requestId", type: "uint256" },
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "perAgentBudget", type: "uint256" },
      { indexed: false, name: "payload", type: "bytes" },
      { indexed: false, name: "subcommittee", type: "address[]" },
    ],
  },
  {
    type: "event",
    name: "RequestFinalized",
    anonymous: false,
    inputs: [
      { indexed: true, name: "requestId", type: "uint256" },
      { indexed: false, name: "status", type: "uint8" },
    ],
  },
] as const;
const finalizedEvent = platformAbi[5];

const llmAbi = [
  {
    type: "function",
    name: "inferString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "response", type: "string" }],
  },
] as const;

export type RiskOfficerResult = {
  verdict: string; // APPROVE | REJECT | UNKNOWN
  requestTx: string;
  resultTx?: string;
  requestId: string;
  response?: string;
  status: string;
  depositStt: string;
  links: { requestTx: string; resultTx?: string; agentUi: string; receipts: string };
};

/** Structured facts about a proposed book. All money in USDso. */
export type BookFacts = {
  legs: {
    symbol: string;
    side: "long" | "short";
    notional: number;
    /** Signed funding APR as a fraction (+1.8 = +180%; positive means longs pay shorts). */
    fundingApr: number;
    /** How much more the pool accepts on this side (getMaxPerpOrderSize), if known. */
    headroom?: number;
    /** Which pool cap binds the headroom (e.g. an OI cap), if known. */
    limitedBy?: string;
  }[];
  stopLossPct: number;
  equity?: number;
};

const POLICY = {
  maxNetPctOfGross: 10,
  maxLossPctOfEquity: 5,
  maxGrossLeverage: 3,
};

const SYSTEM =
  "You are the risk officer of an automated funding-carry bot on a crypto perpetuals DEX. " +
  "Judge ONLY the facts given; every number is already computed, do not recompute or invent any. " +
  "Reply with exactly one line in the format `APPROVE: <reason>` or `REJECT: <reason>`, " +
  "where the reason cites the specific numbers that decided it.";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `${Math.round(x * 100) / 100} USDso`;

/** Render facts plus derived figures, so the model judges numbers instead of doing arithmetic. */
export function factsPrompt(f: BookFacts): string {
  const lines: string[] = ["PROPOSED BOOK"];
  let gross = 0;
  let net = 0;
  let carryDay = 0;
  let headroomOk = true;
  for (const l of f.legs) {
    const receives = (l.side === "short") === l.fundingApr > 0;
    const legCarry = ((receives ? 1 : -1) * Math.abs(l.fundingApr) * l.notional) / 365;
    gross += l.notional;
    net += l.side === "long" ? l.notional : -l.notional;
    carryDay += legCarry;
    if (l.headroom !== undefined && l.notional > l.headroom) headroomOk = false;
    const room =
      l.headroom === undefined
        ? "pool headroom unknown"
        : `pool headroom ${usd(l.headroom)}${l.limitedBy ? ` (bound by ${l.limitedBy})` : ""}, ${l.notional <= l.headroom ? "fits" : "EXCEEDS headroom"}`;
    lines.push(
      `- ${l.side.toUpperCase()} ${l.symbol}: notional ${usd(l.notional)}, funding ${pct(l.fundingApr)} APR, ` +
        `this leg ${receives ? "RECEIVES" : "PAYS"} funding (${usd(legCarry)}/day), ${room}`,
    );
  }
  const maxLoss = (gross * f.stopLossPct) / 100;
  const netPct = gross > 0 ? (Math.abs(net) / gross) * 100 : 0;
  lines.push(
    "TOTALS",
    `- gross notional ${usd(gross)}; net exposure ${usd(net)} (${netPct.toFixed(1)}% of gross)`,
    `- per-leg stop-loss ${f.stopLossPct}%; max loss if every stop hits ${usd(maxLoss)}`,
    `- expected net funding ${usd(carryDay)}/day (${usd(carryDay * 365)}/year)`,
  );
  if (f.equity !== undefined && f.equity > 0) {
    lines.push(
      `- account equity ${usd(f.equity)}; gross leverage ${(gross / f.equity).toFixed(2)}x; ` +
        `max loss = ${((maxLoss / f.equity) * 100).toFixed(1)}% of equity`,
    );
  } else lines.push("- account equity unknown");
  lines.push(`- all legs within pool headroom: ${headroomOk ? "yes" : "NO"}`);
  lines.push(
    "POLICY (approve only if ALL hold)",
    `1. |net exposure| <= ${POLICY.maxNetPctOfGross}% of gross notional`,
    "2. every leg RECEIVES funding and expected net funding is positive",
    `3. max loss <= ${POLICY.maxLossPctOfEquity}% of equity and gross leverage <= ${POLICY.maxGrossLeverage}x`,
    "4. every leg fits within its pool headroom",
    "Answer in the format APPROVE: <reason referencing the numbers> or REJECT: <reason referencing the numbers>.",
  );
  return lines.join("\n");
}

/** Example books used for the live tests (`--example good|bad`). */
export const EXAMPLE_BOOKS: Record<string, BookFacts> = {
  good: {
    legs: [
      { symbol: "BTC-PERP", side: "short", notional: 100, fundingApr: 1.8, headroom: 5000, limitedBy: "openInterestCap" },
      { symbol: "LIT-PERP", side: "long", notional: 100, fundingApr: -0.42, headroom: 2000, limitedBy: "openInterestCap" },
    ],
    stopLossPct: 4,
    equity: 500,
  },
  bad: {
    legs: [{ symbol: "BTC-PERP", side: "long", notional: 2000, fundingApr: 1.8, headroom: 1500, limitedBy: "openInterestCap" }],
    stopLossPct: 4,
    equity: 100,
  },
};

export async function askRiskOfficer(book: string | BookFacts): Promise<RiskOfficerResult> {
  const pk = (process.env.SOMNIA_AGENT_PRIVATE_KEY ?? process.env.PRIVATE_KEY)?.trim();
  if (!pk) throw new Error("SOMNIA_AGENT_PRIVATE_KEY is not set");
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
  const rpc = process.env.SOMNIA_AGENT_RPC ?? SHANNON.rpcUrls.default.http[0];
  const maxDeposit = parseEther(process.env.SOMNIA_AGENT_MAX_DEPOSIT_STT ?? "1");
  const timeoutMs = Number(process.env.SOMNIA_AGENT_TIMEOUT_MS ?? 300_000);
  const pub = createPublicClient({ chain: SHANNON, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: SHANNON, transport: http(rpc) });

  // Deposit exactly like the Agent Explorer: reserve floor + price * subcommittee size.
  const [floor, size] = await Promise.all([
    pub.readContract({ address: SOMNIA_AGENTS, abi: platformAbi, functionName: "getRequestDeposit" }),
    pub.readContract({ address: SOMNIA_AGENTS, abi: platformAbi, functionName: "defaultSubcommitteeSize" }),
  ]);
  const deposit = floor + LLM_PRICE_PER_AGENT * size;
  if (deposit > maxDeposit) throw new Error(`deposit ${formatEther(deposit)} STT exceeds cap ${formatEther(maxDeposit)} STT`);

  const prompt =
    typeof book === "string"
      ? `Proposed funding-carry book on a perp DEX: ${book}.\nAnswer in the format APPROVE: <reason referencing the numbers> or REJECT: <reason referencing the numbers>.`
      : factsPrompt(book);
  const payload = encodeFunctionData({ abi: llmAbi, functionName: "inferString", args: [prompt, SYSTEM, false, []] });

  const { request } = await pub.simulateContract({
    account,
    address: SOMNIA_AGENTS,
    abi: platformAbi,
    functionName: "createRequest",
    args: [LLM_INFERENCE_AGENT_ID, "0x0000000000000000000000000000000000000000", "0x00000000", payload],
    value: deposit,
  });
  const requestTx = await wallet.writeContract(request);
  return readRiskOfficer(requestTx, { rpc, timeoutMs });
}

/** Wait for (or re-read) the consensus answer of a createRequest tx. Read-only, costs nothing. */
export async function readRiskOfficer(
  requestTx: Hex,
  opts: { rpc?: string; timeoutMs?: number } = {},
): Promise<RiskOfficerResult> {
  const pub = createPublicClient({ chain: SHANNON, transport: http(opts.rpc ?? SHANNON.rpcUrls.default.http[0]) });
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const explorer = SHANNON.blockExplorers.default.url;
  // Receipt first: right after sending, the RPC may not serve getTransaction yet.
  const rcpt = await pub.waitForTransactionReceipt({ hash: requestTx });
  const sent = await pub.getTransaction({ hash: requestTx });
  if (rcpt.status !== "success") throw new Error(`createRequest reverted: ${requestTx}`);

  let requestId: bigint | undefined;
  for (const l of rcpt.logs) {
    if (l.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: platformAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "RequestCreated") requestId = ev.args.requestId;
    } catch {
      /* other event */
    }
  }
  if (requestId === undefined) throw new Error(`no RequestCreated in ${requestTx}`);

  // Wait for consensus. A finalized request is deleted from storage (getRequest
  // then reverts RequestNotFound), so we watch for RequestFinalized instead.
  const t0 = Date.now();
  let fin: { tx: Hex; status: number } | undefined;
  let scanned = rcpt.blockNumber;
  while (!fin && Date.now() - t0 < timeoutMs) {
    const latest = await pub.getBlockNumber();
    for (let from = scanned; from <= latest && !fin; from += 1000n) {
      const to = from + 999n > latest ? latest : from + 999n;
      const logs = await pub.getLogs({ address: SOMNIA_AGENTS, event: finalizedEvent, args: { requestId }, fromBlock: from, toBlock: to });
      if (logs[0]) fin = { tx: logs[0].transactionHash, status: logs[0].args.status ?? 0 };
      scanned = to + 1n;
    }
    if (!fin) await new Promise((r) => setTimeout(r, 2000));
  }
  const status = fin ? (STATUS[fin.status] ?? String(fin.status)) : "Pending";
  const resultTx = fin?.tx;

  // Consensus answer: the finalizing tx is the validator submitResponse that
  // reached the threshold, so its calldata carries the agreed result bytes.
  let response: string | undefined;
  if (fin && status === "Success") {
    try {
      const tx = await pub.getTransaction({ hash: fin.tx });
      const call = decodeFunctionData({ abi: platformAbi, data: tx.input });
      if (call.functionName === "submitResponse") response = decodeString(call.args[1]);
    } catch {
      /* fall through to receipts */
    }
    response ??= await fromReceipts(requestId);
  }
  // Prefer the leading "APPROVE:" / "REJECT:" token the prompt asks for.
  const up = response?.toUpperCase().replace(/^[\s`*"']+/, "");
  const m = up?.match(/^(APPROVE|REJECT)\b/) ?? up?.match(/\b(APPROVE|REJECT)\b/);
  return {
    verdict: m?.[1] ?? "UNKNOWN",
    requestTx,
    resultTx,
    requestId: requestId.toString(),
    response,
    status,
    depositStt: formatEther(sent.value),
    links: {
      requestTx: `${explorer}/tx/${requestTx}`,
      resultTx: resultTx ? `${explorer}/tx/${resultTx}` : undefined,
      agentUi: `${AGENTS_UI}/agent/${LLM_INFERENCE_AGENT_ID}`,
      receipts: `${RECEIPTS_URL}/agent-receipts?contractAddress=${SOMNIA_AGENTS}&requestId=${requestId}&type=minimal`,
    },
  };
}

function decodeString(result: Hex): string {
  return decodeFunctionResult({ abi: llmAbi, functionName: "inferString", data: result });
}

/** Fallback: per-validator execution receipts (agentReceipt.result is the ABI-encoded output). */
async function fromReceipts(requestId: bigint): Promise<string | undefined> {
  try {
    const res = await fetch(`${RECEIPTS_URL}/agent-receipts?contractAddress=${SOMNIA_AGENTS}&requestId=${requestId}&type=minimal`);
    const body = (await res.json()) as { receipts?: { status?: string; agentReceipt?: { result?: string } }[] };
    const hit = body.receipts?.find((r) => r.status === "success" && r.agentReceipt?.result?.startsWith("0x"));
    return hit ? decodeString(hit.agentReceipt!.result as Hex) : undefined;
  } catch {
    return undefined;
  }
}

// CLI: npx tsx src/somnia-agent.ts "short BTC-PERP 100 USDso at +180% APR ..."   (sends a request)
//      npx tsx src/somnia-agent.ts --example good|bad                              (sends a request)
//      npx tsx src/somnia-agent.ts --print good|bad                                (shows the prompt, free)
//      npx tsx src/somnia-agent.ts --tx 0x<createRequest tx>                      (re-reads, free)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  const args = process.argv.slice(2);
  const example = (name: string | undefined) => {
    const b = EXAMPLE_BOOKS[name ?? ""];
    if (!b) throw new Error(`unknown example ${name}; use ${Object.keys(EXAMPLE_BOOKS).join("|")}`);
    return b;
  };
  if (args[0] === "--print") {
    console.log(`SYSTEM: ${SYSTEM}\n\n${factsPrompt(example(args[1]))}`);
    process.exit(0);
  }
  const run =
    args[0] === "--tx"
      ? readRiskOfficer(args[1] as Hex)
      : askRiskOfficer(args[0] === "--example" ? example(args[1]) : args.join(" ") || example("good"));
  run.then(
    (r) => console.log(JSON.stringify(r, null, 2)),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
