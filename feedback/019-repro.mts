// 019: Trader docs say ADL closes "those with the most profit relative to their account's equity first".
// The armed ADL ranker orders candidates by leverage (position notional / equity) and ignores profit.
// Read-only, no key: view calls only (MarginBank/LiquidationEngine reads, AdlRanker.rank() eth_call, SDK perpAdlQueue).
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 019-repro.mts
import { createPublicClient, http, parseAbi } from "viem"
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const G = "https://hideki-dev.smk.somnia.host/v1/graphql"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const c = createPublicClient({ transport: http(RPC) })
const sdk = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: G, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })
const ab = parseAbi([
  "function getAdlRanker() view returns (address)",
  "function rank(address bankrupt, (address account, address perpPool, int128 size, uint128 entryPrice, uint256 markPrice, int256 accountEquity)[] candidates) view returns (uint256[] ordering)",
  "function tryGetHealthSnapshot() view returns (bool ok, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps) snapshot)",
])
const head = await c.getBlockNumber()
const LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D" // MarginBank.getSystemConfig().liquidationEngine
const ranker = await c.readContract({ address: LE, abi: ab, functionName: "getAdlRanker", blockNumber: head })
console.log(`head ${head}; LiquidationEngine ${LE}; armed AdlRanker ${ranker}`)

// 1. Direct question to the ranker: two profitable ETH longs at the current mark.
const ETH = "0xd6cb1dd58580b84d76068ac21594219ce03aeddf"
const [, s]: any = await c.readContract({ address: ETH, abi: ab, functionName: "tryGetHealthSnapshot", blockNumber: head })
const M = s.markPrice, one = 10n ** 18n
const cands = [
  { name: "A: +100% on the position, 1x leverage", account: "0x00000000000000000000000000000000000a11ce", perpPool: ETH, size: one, entryPrice: M / 2n, markPrice: M, accountEquity: M },
  { name: "B: +0.1% on the position, 15x leverage", account: "0x0000000000000000000000000000000000000b0b", perpPool: ETH, size: one, entryPrice: (M * 999n) / 1000n, markPrice: M, accountEquity: M / 15n },
]
for (const x of cands) { const pnl = (x.markPrice - x.entryPrice) * x.size / one; console.log(`  ${x.name}: pnl ${Number(pnl) / 1e18} USDso, equity ${Number(x.accountEquity) / 1e18}, pnl/equity ${(Number(pnl) / Number(x.accountEquity)).toFixed(4)}, notional/equity ${(Number(x.size * x.markPrice / one) / Number(x.accountEquity)).toFixed(2)}x`) }
const ord = await c.readContract({ address: ranker, abi: ab, functionName: "rank", args: ["0x000000000000000000000000000000000000dead", cands.map(({ name, ...t }) => t) as any], blockNumber: head })
console.log(`AdlRanker.rank([A, B]) -> [${ord}]  => closes first: ${cands[Number(ord[0])].name}`)

// 2. Live queues: compare the ranker's order with profit/equity and with leverage (Spearman rank correlation).
const spear = (a: number[], b: number[]) => { const r = (x: number[]) => { const o = Array(x.length); x.map((v, k) => [v, k]).sort((p, q) => p[0] - q[0]).forEach((p, k) => (o[p[1]] = k)); return o }; const ra = r(a), rb = r(b), n = a.length; let d = 0; for (let k = 0; k < n; k++) d += (ra[k] - rb[k]) ** 2; return 1 - (6 * d) / (n * (n * n - 1)) }
const sides: [string, string, boolean][] = [["ETH", ETH, true], ["ETH", ETH, false], ["SOL", "0xb483ec1fb34996638677c20ab087b16f1896fa53", true], ["SOL", "0xb483ec1fb34996638677c20ab087b16f1896fa53", false], ["XRP", "0x7058579f3248559963f79adb937c6de9f953e060", false], ["BTC", "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", false]]
for (const [sym, pool, isLong] of sides) {
  const v: any = await (sdk.client as any).perpAdlQueue.getSnapshot({ marginBank: MB, pool, isLong })
  const q = v.data.queue, blk = v.data.blockNumber
  if (q.regime !== "ranked") { console.log(`${sym} ${isLong ? "long" : "short"}: regime ${q.regime}`); continue }
  const [, sn]: any = await c.readContract({ address: pool as any, abi: ab, functionName: "tryGetHealthSnapshot", blockNumber: blk })
  const cs = q.holders.filter((h: any) => h.eligibility === "candidate").sort((a: any, b: any) => a.adlRank - b.adlRank)
  const first = cs.map((h: any) => -h.adlRank)
  const pe = cs.map((h: any) => Number(((sn.markPrice - h.avgEntryPrice) * h.size) / sn.oneBase) / Number(h.equity))
  const lev = cs.map((h: any) => Number(h.positionLeverageBps))
  console.log(`${sym} ${isLong ? "long " : "short"} block ${blk}: ${cs.length} candidates (ranker ${q.orderSource}); Spearman(order, pnl/equity) ${spear(first, pe).toFixed(3)}  Spearman(order, notional/equity) ${spear(first, lev).toFixed(3)}`)
  if (sym === "ETH" && isLong) {
    for (const h of cs.slice(0, 4)) { const i = cs.indexOf(h); console.log(`    #${h.adlRank} ${h.account} pnl/equity ${pe[i].toFixed(4)}  leverage ${(lev[i] / 1e4).toFixed(2)}x`) }
    const best = pe.indexOf(Math.max(...pe)); console.log(`    highest pnl/equity on this side: #${cs[best].adlRank} ${cs[best].account} pnl/equity ${pe[best].toFixed(4)} leverage ${(lev[best] / 1e4).toFixed(2)}x`)
  }
}
process.exit(0)
