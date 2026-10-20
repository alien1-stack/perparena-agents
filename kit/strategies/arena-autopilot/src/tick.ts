// arena-autopilot: a delta-capped funding-carry book across ALL dreamDEX perp
// markets, designed to run as ONE short tick (cron / GitHub Actions), not as a
// long-lived process. Each tick:
//   1. reads live funding on every market and ranks them by |APR|
//   2. builds a target book: the paid side of the best-paying markets, added
//      greedily while |long notional - short notional| stays under NET_CAP
//   3. exits legs that left the target, whose funding fell under EXIT_APR, or
//      that hit the per-leg stop-loss (watched here, because a trading key
//      cannot arm stops for the account)
//   3b. (AUTOPILOT_SOMNIA_AGENT=advisory|gate) asks Somnia's on-chain LLM agent
//      to APPROVE/REJECT the target book; in gate mode anything but APPROVE
//      skips entries, in advisory mode the verdict is only journaled
//   4. opens missing legs with IOC orders sized by the pool's own rules
//   5. appends every decision and tx hash to journal/ and rewrites
//      site/data.json, which the public dashboard reads
//
// DRY_RUN=true (default) sends nothing and still writes the journal.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ORDER_TYPE,
  alignPrice,
  alignQuantity,
  createExchange,
  envNum,
  liveFunding,
  liveMark,
  loadEnv,
  marginSnapshot,
  perpMarkets,
  placeFor,
  shutdown,
  sizeForNotional,
  sizeOrder,
  tradingKeyCheck,
  type PerpMarket,
  type Side,
} from "@dreamdex-bot-kit/perp-core";
import { askRiskOfficer, type BookFacts } from "./somnia-agent.js";

loadEnv();
const LEG_NOTIONAL = envNum("AUTOPILOT_LEG_NOTIONAL_USDSO", 100);
const MAX_LEGS = envNum("AUTOPILOT_MAX_LEGS", 4);
const NET_CAP = envNum("AUTOPILOT_NET_CAP_USDSO", 150);
const MIN_APR = envNum("AUTOPILOT_MIN_APR", 0.15);
const EXIT_APR = envNum("AUTOPILOT_EXIT_APR", 0.05);
const STOP_LOSS_PCT = envNum("AUTOPILOT_STOP_LOSS_PCT", 4);
const SLIPPAGE_BPS = envNum("AUTOPILOT_SLIPPAGE_BPS", 30);
const OUT = resolve(process.env.AUTOPILOT_OUT_DIR ?? resolve(process.cwd(), "../../.."));
// Somnia on-chain LLM risk officer (needs SOMNIA_AGENT_PRIVATE_KEY with STT on Shannon).
// unset/false: off. advisory (or true): ask and journal only. gate: also skip entries unless APPROVE.
const SOMNIA_MODE = ((): "off" | "advisory" | "gate" => {
  const v = (process.env.AUTOPILOT_SOMNIA_AGENT ?? "").toLowerCase();
  if (v === "gate") return "gate";
  if (v === "advisory" || v === "true") return "advisory";
  return "off";
})();

type Leg = { symbol: string; side: Side; apr: number; notional: number };
type View = { m: PerpMarket; mark: number | undefined };

/** Facts for the risk officer: legs, stop-loss, equity, and pool headroom read from getMaxPerpOrderSize. */
async function bookFacts(
  ctx: ReturnType<typeof createExchange>,
  book: Leg[],
  bySymbol: Map<string, View>,
  account: `0x${string}` | undefined,
): Promise<BookFacts> {
  const legs: BookFacts["legs"] = [];
  for (const l of book) {
    const v = bySymbol.get(l.symbol);
    const leg: BookFacts["legs"][number] = { symbol: v?.m.display ?? l.symbol, side: l.side, notional: l.notional, fundingApr: l.apr };
    if (account && v?.mark !== undefined) {
      try {
        const price = alignPrice(BigInt(Math.round(v.mark * 1e18)), v.m.info);
        const max = await sizeOrder(ctx.exchange, { market: v.m, account, side: l.side, price, wanted: 2n ** 200n, tradingKey: ctx.tradingKey });
        leg.headroom = (Number(max.quantity) / 10 ** v.m.info.baseDecimals) * v.mark;
        leg.limitedBy = max.limitedBy ?? max.reason;
      } catch {
        /* headroom stays unknown */
      }
    }
    legs.push(leg);
  }
  let equity: number | undefined;
  const first = book[0] && bySymbol.get(book[0].symbol);
  if (account && first) {
    try {
      equity = Number((await marginSnapshot(ctx.exchange, first.m, account)).equity) / 1e18;
    } catch {
      /* equity stays unknown */
    }
  }
  return { legs, stopLossPct: STOP_LOSS_PCT, equity };
}

/** "short BTC-PERP 100 USDso at +180.0% APR funding, long LIT-PERP ..., net exposure 0 USDso" */
function bookSummary(book: Leg[]): string {
  const legs = book.map((l) => `${l.side} ${l.symbol} ${l.notional} USDso at ${l.apr >= 0 ? "+" : ""}${(l.apr * 100).toFixed(1)}% APR funding`);
  const net = book.reduce((s, l) => s + (l.side === "long" ? l.notional : -l.notional), 0);
  return `${legs.join(", ")}, net exposure ${net} USDso`;
}
type Event = Record<string, unknown> & { t: string; kind: string };

const now = () => new Date().toISOString();
const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const events: Event[] = [];
function log(kind: string, data: Record<string, unknown> = {}) {
  const e = { t: now(), kind, ...data };
  events.push(e);
  console.log(kind, JSON.stringify(data, big));
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main() {
  const live = process.env.DRY_RUN === "false";
  const ctx = createExchange({ withSigner: live || Boolean(process.env.PRIVATE_KEY) });
  const markets = await perpMarkets(ctx.exchange, true);
  const account = (ctx.config.owner ?? ctx.exchange.walletAddress) as `0x${string}` | undefined;
  log("tick", { live, account, markets: markets.length, tradingKey: Boolean(ctx.tradingKey) });

  // 1. Live funding and marks for every market.
  const view = await Promise.all(
    markets.map(async (m) => {
      const [f, mark] = await Promise.all([liveFunding(ctx.exchange, m), liveMark(ctx.exchange, m)]);
      return { m, f, mark };
    }),
  );
  const bySymbol = new Map(view.map((v) => [v.m.symbol, v]));

  // 2. Target book: best |APR| first, greedy under the net-exposure cap.
  const ranked = view
    .filter((v) => v.f.known && v.mark !== undefined && Math.abs(v.f.apr) >= MIN_APR)
    .sort((a, b) => Math.abs(b.f.apr) - Math.abs(a.f.apr));
  const target: Leg[] = [];
  let net = 0;
  for (const v of ranked) {
    if (target.length >= MAX_LEGS) break;
    const signed = v.f.paidSide === "long" ? LEG_NOTIONAL : -LEG_NOTIONAL;
    if (Math.abs(net + signed) > NET_CAP) continue;
    net += signed;
    target.push({ symbol: v.m.symbol, side: v.f.paidSide, apr: v.f.apr, notional: LEG_NOTIONAL });
  }
  log("target", { net, legs: target.map((l) => `${l.side} ${l.symbol} ${(l.apr * 100).toFixed(1)}%`) });

  let riskOfficer: Record<string, unknown> | undefined;
  const positions = account ? await ctx.exchange.fetchPositions() : [];
  const wanted = new Map(target.map((l) => [l.symbol, l]));

  // 3. Exits.
  for (const p of positions) {
    const v = bySymbol.get(p.symbol);
    if (!v) continue;
    const notional = p.contracts * (p.markPrice ?? v.mark ?? p.entryPrice);
    const pnlPct = notional > 0 ? ((p.unrealizedPnl ?? 0) / notional) * 100 : 0;
    const leg = wanted.get(p.symbol);
    let reason: string | undefined;
    if (pnlPct <= -STOP_LOSS_PCT) reason = `stop-loss ${pnlPct.toFixed(2)}%`;
    else if (!leg || leg.side !== p.side) reason = "left target book";
    else if (Math.abs(v.f.apr) < EXIT_APR) reason = `funding ${(v.f.apr * 100).toFixed(1)}% under exit`;
    if (!reason) {
      wanted.delete(p.symbol); // already holding it
      log("hold", { symbol: p.symbol, side: p.side, contracts: p.contracts, uPnl: p.unrealizedPnl, apr: v.f.apr });
      continue;
    }
    await trade(ctx, v.m, p.side === "long" ? "short" : "long", BigInt(Math.floor(p.contracts * 10 ** v.m.info.baseDecimals)), v.mark!, `close (${reason})`, live, account);
  }

  // 3b. Somnia Agents risk officer: an on-chain LLM (Somnia Shannon testnet,
  // validator consensus) reviews the target book before new legs open.
  // advisory: verdict is journaled only. gate: anything but APPROVE (REJECT,
  // no verdict, error) skips entries; exits above already ran, so the gate
  // can only ever reduce risk.
  if (SOMNIA_MODE !== "off" && wanted.size > 0) {
    const facts = await bookFacts(ctx, target, bySymbol, account);
    const summary = bookSummary(target);
    let verdict = "ERROR";
    try {
      const r = await askRiskOfficer(facts);
      verdict = r.verdict;
      riskOfficer = { mode: SOMNIA_MODE, summary, facts, ...r };
      log("somnia-agent", { mode: SOMNIA_MODE, summary, verdict: r.verdict, response: r.response, status: r.status, requestId: r.requestId, requestTx: r.requestTx, resultTx: r.resultTx, depositStt: r.depositStt, links: r.links });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      riskOfficer = { mode: SOMNIA_MODE, summary, facts, verdict, error: msg.slice(0, 300) };
      log("somnia-agent-error", { mode: SOMNIA_MODE, summary, error: msg.slice(0, 300) });
    }
    if (verdict !== "APPROVE") {
      if (SOMNIA_MODE === "gate") {
        log("skip-entries", { reason: `somnia risk officer ${verdict}`, legs: [...wanted.keys()] });
        wanted.clear();
      } else log("advisory", { note: `somnia risk officer ${verdict}; advisory mode, entries proceed`, legs: [...wanted.keys()] });
    }
  }

  // 4. Entries.
  for (const leg of wanted.values()) {
    const v = bySymbol.get(leg.symbol)!;
    const qty = sizeForNotional(leg.notional, v.m.info, v.mark);
    await trade(ctx, v.m, leg.side, qty, v.mark!, `open carry ${(leg.apr * 100).toFixed(1)}% APR`, live, account);
  }

  // 5. Snapshot for the dashboard.
  const after = account && live ? await ctx.exchange.fetchPositions() : positions;
  let margin: Record<string, unknown> | undefined;
  if (account && markets[0]) {
    const s = await marginSnapshot(ctx.exchange, markets[0], account);
    margin = { equity: Number(s.equity) / 1e18, unlocked: Number(s.unlocked) / 1e18, locked: Number(s.locked) / 1e18 };
  }
  const snapshot = {
    updatedAt: now(),
    live,
    account,
    params: { LEG_NOTIONAL, MAX_LEGS, NET_CAP, MIN_APR, EXIT_APR, STOP_LOSS_PCT },
    margin,
    positions: after.map((p) => ({ symbol: p.symbol, side: p.side, contracts: p.contracts, entry: p.entryPrice, mark: p.markPrice, uPnl: p.unrealizedPnl })),
    funding: view
      .map((v) => ({ symbol: v.m.symbol, apr: v.f.apr, paidSide: v.f.paidSide, mark: v.mark }))
      .sort((a, b) => Math.abs(b.apr) - Math.abs(a.apr)),
    target,
    riskOfficer,
  };
  writeJson(resolve(OUT, "docs/data.json"), snapshot);
  mkdirSync(resolve(OUT, "journal"), { recursive: true });
  const day = now().slice(0, 10);
  appendFileSync(resolve(OUT, `journal/${day}.jsonl`), events.map((e) => JSON.stringify(e, big)).join("\n") + "\n");
  const tradesPath = resolve(OUT, "docs/trades.json");
  const prior = existsSync(tradesPath) ? (JSON.parse(readFileSync(tradesPath, "utf8")) as Event[]) : [];
  writeJson(tradesPath, [...events.filter((e) => e.kind === "trade"), ...prior].slice(0, 500));
  await shutdown(ctx);
}

async function trade(
  ctx: ReturnType<typeof createExchange>,
  m: PerpMarket,
  side: Side,
  rawQty: bigint,
  mark: number,
  why: string,
  live: boolean,
  account: `0x${string}` | undefined,
) {
  const touchPx = BigInt(Math.round(mark * 1e18));
  const slip = BigInt(SLIPPAGE_BPS);
  const price = alignPrice(side === "long" ? (touchPx * (10_000n + slip)) / 10_000n : (touchPx * (10_000n - slip)) / 10_000n, m.info);
  let quantity = alignQuantity(rawQty, m.info);
  const base = { symbol: m.symbol, side, why, price: Number(price) / 1e18 };
  if (quantity < BigInt(m.info.minQuantity)) return log("skip", { ...base, reason: "under minQuantity" });
  if (account) {
    const sized = await sizeOrder(ctx.exchange, { market: m, account, side, price, wanted: quantity, tradingKey: ctx.tradingKey });
    if (!sized.ok) return log("skip", { ...base, reason: sized.reason ?? sized.limitedBy });
    quantity = sized.quantity;
  }
  const qtyHuman = Number(quantity) / 10 ** m.info.baseDecimals;
  if (!live) return log("dry-run", { ...base, quantity: qtyHuman });
  try {
    const order = { pool: m.info.poolAddress, isBid: side === "long", price, quantity, orderType: ORDER_TYPE.MARKET };
    const res = ctx.tradingKey ? await placeFor(ctx.tradingKey, order) : await ctx.exchange.trader.placePerpOrder(order);
    const r = res as { hash?: string; orderId?: bigint; fills?: { quantityFilled: bigint }[] };
    const filled = (r.fills ?? []).reduce((s, f) => s + f.quantityFilled, 0n);
    log("trade", { ...base, quantity: qtyHuman, filled: Number(filled) / 10 ** m.info.baseDecimals, hash: r.hash, orderId: r.orderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(msg.includes("ImmediateOrCancelNoFill") ? "no-fill" : "error", { ...base, error: msg.slice(0, 300) });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
