// 021: The SDK's position analytics (perpPositionAnalytics / get|listPerpPositionAnalytics) truncate unrealized PnL
// toward zero, documented as "a direct port" that "re-sums to the bank's own equity to the wei". The MarginBank floors
// it toward -inf, so every losing position whose PnL division is inexact is 1 wei better in the SDK than on chain.
// Read-only, no key: view calls only, all pinned to one block.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 021-repro.mts [positions=200]
import { createPublicClient, http, parseAbi } from "viem"
import { perpPositionAnalytics } from "@somnia-chain/markets-sdk"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const G = "https://hideki-dev.smk.somnia.host/v1/graphql"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const c = createPublicClient({ transport: http(RPC) })
const gq = async (q: string) => (await (await fetch(G, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json()).data
const ab = parseAbi([
  "function tryGetHealthSnapshot() view returns (bool ok, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps) snapshot)",
  "function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getAccountHealth(address account) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
])
const head = await c.getBlockNumber()
const rd = (address: any, fn: string, args: any[] = []) => c.readContract({ address, abi: ab, functionName: fn as any, args, blockNumber: head } as any) as Promise<any>
const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q }
const rows = (await gq(`{ PerpPosition(where:{size:{_neq:"0"}}, order_by:{updatedAtBlock:desc}, limit:${Number(process.argv[2] ?? 200)}){ account } }`)).PerpPosition
let n = 0, sdkOk = 0, floorOk = 0, shown = 0, positions = 0, losingInexact = 0
for (const a of [...new Set(rows.map((r: any) => r.account))] as string[]) {
  const [st, h] = await Promise.all([rd(MB, "getAccountState", [a]), rd(MB, "getAccountHealth", [a])])
  let sdkSum = 0n, floorSum = 0n, ok = true, lossCnt = 0
  for (const pool of st.activePerpPools) {
    const [pos, [pOk, s]] = await Promise.all([rd(MB, "getPosition", [a, pool]), rd(pool, "tryGetHealthSnapshot")])
    if (!pOk) { ok = false; break }
    const m = perpPositionAnalytics({ size: pos.size, avgEntryPrice: pos.avgEntryPrice, entryFundingIndex: pos.entryFundingIndex, markPrice: s.markPrice, projectedCumulativeFunding: s.projectedCumulativeFunding, oneBase: s.oneBase, effectiveImfBps: s.effectiveIMFBps, maintenanceMarginBps: s.maintenanceMarginBps, closeOutMarginBps: s.closeOutMarginBps })
    sdkSum += m.equityContribution
    const num = (s.markPrice - pos.avgEntryPrice) * pos.size
    floorSum += m.equityContribution - m.unrealizedPnl + (pos.size === 0n ? 0n : floorDiv(num, s.oneBase)) // same funding leg, PnL floored
    if (pos.size !== 0n) { positions++; if (num < 0n && num % s.oneBase !== 0n) { losingInexact++; lossCnt++ } }
  }
  if (!ok) continue
  n++
  const equity = h[0] as bigint, unl = st.unlockedCollateralBalance as bigint
  if (unl + sdkSum === equity) sdkOk++
  if (unl + floorSum === equity) floorOk++
  else console.log(`  floor variant mismatch ${a}`)
  if (unl + sdkSum !== equity && shown++ < 5) console.log(`${a} ${st.activePerpPools.length} market(s), ${lossCnt} losing with inexact PnL: getAccountHealth().equity ${equity}  unlocked + Σ SDK equityContribution ${unl + sdkSum}  (SDK - bank = ${unl + sdkSum - equity} wei)`)
}
console.log(`head ${head}: ${n} accounts, ${positions} positions (${losingInexact} at a loss with an inexact PnL division)`)
console.log(`  unlocked + Σ perpPositionAnalytics().equityContribution == getAccountHealth().equity on ${sdkOk}/${n}`)
console.log(`  same sum with unrealized PnL floored toward -inf                     on ${floorOk}/${n}`)
process.exit(0)
