// 010: MarginBank never writes Position.lastUpdatedTimestampNs, so every open position reads 0 and
// SomniaMarkets.fetchPositions() stamps every position 1970-01-01. Read-only, no key (address-only account).
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 010-repro.mts
import { createPublicClient, http, parseAbi } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => (await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json()).data
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const abi = parseAbi([
  "function getPosition(address account, address pool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
  "function getSideHolderStatesPaginated(address pool, bool isLong, uint256 start, uint256 count) view returns ((address account, bool priceable, uint8 status, int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq, (int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs) position, int256 unlockedCollateralBalance, uint256 lockedCollateral)[] states, uint256 listLength, bool poolPriceable, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 staticIMFBps) poolSnapshot)",
])
const B = await c.getBlockNumber()
// 1. Every open position on every perp pool, at one block.
const markets = (await gq('{ Market(where:{marketType:{_eq:"PERP"}}) { baseSymbol poolAddress } }')).Market
let open = 0, zero = 0
for (const m of markets) for (const isLong of [true, false]) for (let s = 0n; ; s += 500n) {
  const [states, len] = await c.readContract({ address: MB, abi, functionName: "getSideHolderStatesPaginated", args: [m.poolAddress, isLong, s, 500n], blockNumber: B }) as any
  for (const x of states) { open++; if (x.position.lastUpdatedTimestampNs === 0n) zero++ }
  if (s + 500n >= len) break
}
console.log(`block ${B}: open positions ${open}, with lastUpdatedTimestampNs == 0: ${zero}`)
// 2. Positions the indexer saw change in the last few minutes still read 0 from getPosition.
const ch = (await gq('{ PerpPositionChange(order_by:{blockNumber:desc}, limit: 40, where:{sizeAfter:{_neq:"0"}}) { account pool sizeAfter kind timestamp blockNumber txHash } }')).PerpPositionChange
const seen = new Set<string>(); let shown = 0, fresh: any
for (const r of ch) {
  const k = r.account + r.pool; if (seen.has(k)) continue; seen.add(k)
  const p: any = await c.readContract({ address: MB, abi, functionName: "getPosition", args: [r.account, r.pool] })
  if (!fresh && p.size !== 0n) fresh = r
  if (shown++ < 5) console.log(`  ${r.kind} at block ${r.blockNumber} (ts ${r.timestamp}) tx ${r.txHash.slice(0, 12)}… account ${r.account} -> getPosition size ${p.size} lastUpdatedTimestampNs ${p.lastUpdatedTimestampNs}`)
}
// 3. What the unified exchange reports for that freshly traded position.
const ex: any = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, account: fresh.account } as any)
const pos = await ex.fetchPositions()
for (const p of pos.slice(0, 3)) console.log(`fetchPositions(${fresh.account}): ${p.symbol} ${p.side} contracts=${p.contracts} timestamp=${p.timestamp} datetime=${p.datetime}`)
console.log(`fetchPositions rows: ${pos.length}, with timestamp 0: ${pos.filter((p: any) => p.timestamp === 0).length}`)
process.exit(0)
