// 012: the trader docs say no backstop bidders are registered on testnet; the LiquidationEngine
// has one, and it is taking positions over. Read-only, no key.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 012-repro.mts
import { createPublicClient, http, parseAbi, decodeEventLog } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { liquidationEngineEventsAbi, marginBankEventsAbi } from "@somnia-chain/markets-sdk"
const LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => { const r = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (r.errors) throw new Error(JSON.stringify(r.errors)); return r.data }
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const ab = parseAbi(["function getBidderCount() view returns (uint256)", "function getBidders() view returns (address[])"])
const head = await c.getBlockNumber()
const bidders = await c.readContract({ address: LE, abi: ab, functionName: "getBidders", blockNumber: head })
console.log(`block ${head}: LiquidationEngine.getBidderCount() = ${await c.readContract({ address: LE, abi: ab, functionName: "getBidderCount", blockNumber: head })}, getBidders() = ${JSON.stringify(bidders)}`)

// When did the bidder appear? Binary search on archive state.
let lo = 1n, hi = head
const count = async (b: bigint) => { try { return await c.readContract({ address: LE, abi: ab, functionName: "getBidderCount", blockNumber: b }) } catch { return -1n } }
if ((await count(lo)) !== 0n) lo = 6_900_000n // before the perps stack existed the call fails; start near the deploy
while (hi - lo > 1n) { const mid = (lo + hi) / 2n; const n = await count(mid); if (n > 0n) hi = mid; else lo = mid }
console.log(`getBidderCount: ${await count(lo)} at block ${lo}, ${await count(hi)} at block ${hi} (first block with a registered bidder)`)

// Takeovers by that bidder, from the indexer, confirmed on chain.
const rows = (await gq(`{ LiquidationEvent(where:{kind:{_eq:"PositionTakenOver"}}, order_by:{blockNumber:desc}, limit: 50) { account counterparty pool size price blockNumber txHash } }`)).LiquidationEvent
console.log(`indexed PositionTakenOver events: ${rows.length}`)
for (const r of rows) {
  const rc = await c.getTransactionReceipt({ hash: r.txHash })
  const names: string[] = []
  for (const l of rc.logs) { try { const d: any = decodeEventLog({ abi: [...liquidationEngineEventsAbi, ...marginBankEventsAbi] as any, data: l.data, topics: l.topics }); if (d.eventName === "PositionTakenOver") names.push(`PositionTakenOver(account ${d.args.account}, bidder ${d.args.bidder}, size ${d.args.size}, takeoverPrice ${d.args.takeoverPrice}) from ${l.address}`); else if (["PositionTransferred", "AccountLiquidated", "CloseOutMarginSettled"].includes(d.eventName)) names.push(d.eventName) } catch {} }
  console.log(`  block ${rc.blockNumber} tx ${r.txHash} status ${rc.status}`)
  for (const n of names) console.log(`    ${n}`)
}
process.exit(0)
