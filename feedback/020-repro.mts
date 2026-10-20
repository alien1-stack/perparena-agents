// 020: Trader docs promise ADL hits "the most profit relative to equity first" and show an ADL rank (five bars)
// for every position. On BTC longs the side holds more holders than LiquidationEngine.getMaxAdlScanPerCall(),
// so (per the SDK's own model of the engine) the ranker is never called and ADL walks holders in storage order.
// Read-only, no key: view calls only.  Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:
//   npx tsx 020-repro.mts
import { createPublicClient, http, parseAbi } from "viem"
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const G = "https://hideki-dev.smk.somnia.host/v1/graphql"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D" // MarginBank.getSystemConfig().liquidationEngine
const BTC = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0"
const c = createPublicClient({ transport: http(RPC) })
const sdk = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: G, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })
const ab = parseAbi([
  "function getMaxAdlScanPerCall() view returns (uint256)",
  "function getAdlRanker() view returns (address)",
  "function getSideHolderStatesPaginated(address pool, bool isLong, uint256 start, uint256 count) view returns ((address account, bool priceable, uint8 status, int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq, (int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs) position, int256 unlockedCollateralBalance, uint256 lockedCollateral)[] states, uint256 listLength, bool poolPriceable, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 staticIMFBps) poolSnapshot)",
])
const head = await c.getBlockNumber()
const cap = await c.readContract({ address: LE, abi: ab, functionName: "getMaxAdlScanPerCall", blockNumber: head })
console.log(`head ${head}; LiquidationEngine.getMaxAdlScanPerCall() = ${cap}; ranker ${await c.readContract({ address: LE, abi: ab, functionName: "getAdlRanker", blockNumber: head })}`)

// 1. Holder-list length per side, straight from the MarginBank.
const markets = (await (await fetch(G, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ Market(where:{marketType:{_eq:"PERP"}}){ id baseSymbol } }` }) })).json()).data.Market
const over: string[] = []
for (const m of markets) for (const isLong of [true, false]) {
  const r: any = await c.readContract({ address: MB, abi: ab, functionName: "getSideHolderStatesPaginated", args: [m.id, isLong, 0n, 0n], blockNumber: head })
  if (r[1] > cap) over.push(`${m.baseSymbol} ${isLong ? "long" : "short"}: ${r[1]} holders`)
}
console.log(`sides with more holders than the scan cap (${markets.length * 2} sides checked): ${over.join("; ") || "none"}`)

// 2. What the BTC long list looks like in storage order.
const page = 250n
const first: any = await c.readContract({ address: MB, abi: ab, functionName: "getSideHolderStatesPaginated", args: [BTC, true, 0n, 0n], blockNumber: head })
const n = first[1] as bigint
let mark = 0n, oneBase = 1n
const rows: { i: number; acct: string; profit: boolean; lev: number; pe: number }[] = []
let flat = 0, loss = 0, noEq = 0, unpriced = 0
for (let s = 0n; s < n; s += page) {
  const r: any = await c.readContract({ address: MB, abi: ab, functionName: "getSideHolderStatesPaginated", args: [BTC, true, s, page], blockNumber: head })
  mark = r[3].markPrice; oneBase = r[3].oneBase
  r[0].forEach((h: any, k: number) => {
    const i = Number(s) + k, sz = h.position.size as bigint
    if (sz <= 0n) { flat++; return }
    if (!h.priceable) { unpriced++; return }
    const pnl = ((mark - h.position.avgEntryPrice) * sz) / oneBase
    if (pnl <= 0n) { loss++; return }
    if (h.equity <= 0n) { noEq++; return }
    rows.push({ i, acct: h.account, profit: true, lev: Number((sz * mark) / oneBase) / Number(h.equity), pe: Number(pnl) / Number(h.equity) })
  })
}
const inScan = rows.filter(r => r.i < Number(cap))
const byLev = [...rows].sort((a, b) => b.lev - a.lev), byPe = [...rows].sort((a, b) => b.pe - a.pe)
console.log(`BTC long holder list: ${n} entries; flat ${flat}, not in profit ${loss}, no equity ${noEq}, unpriceable ${unpriced}, ADL candidates ${rows.length} (${inScan.length} of them in the first ${cap} storage slots)`)
console.log(`  first candidate in storage order: slot ${rows[0]?.i} ${rows[0]?.acct} pnl/equity ${rows[0]?.pe.toFixed(4)} leverage ${rows[0]?.lev.toFixed(2)}x`)
console.log(`  highest leverage candidate:       slot ${byLev[0].i} ${byLev[0].acct} pnl/equity ${byLev[0].pe.toFixed(4)} leverage ${byLev[0].lev.toFixed(2)}x`)
console.log(`  highest pnl/equity candidate:     slot ${byPe[0].i} ${byPe[0].acct} pnl/equity ${byPe[0].pe.toFixed(4)} leverage ${byPe[0].lev.toFixed(2)}x`)
console.log(`  top-20 candidates by pnl/equity that sit past slot ${cap}: ${byPe.slice(0, 20).filter(r => r.i >= Number(cap)).length}/20`)

// 3. The SDK's own ADL-queue read for the same side.
const v: any = await (sdk.client as any).perpAdlQueue.getSnapshot({ marginBank: MB, pool: BTC, isLong: true })
const q = v.data.queue
console.log(`SDK perpAdlQueue.getSnapshot(BTC long): regime "${q.regime}", holderCount ${q.holderCount}, scanCap ${q.scanCap}, holders listed: ${q.holders?.length ?? "none"}`)
process.exit(0)
