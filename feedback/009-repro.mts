// 009: a perp taker fills straight past expired-but-stored makers; no ExpiredOrderMustBeCancelled revert.
// Read-only. Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 009-repro.mts
import { createPublicClient, http, parseAbi } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string): Promise<any> => { for (let t = 0; t < 4; t++) { const j = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (!j.errors) return j.data; await new Promise(r => setTimeout(r, 1500)) } throw new Error("indexer") }
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const abi = parseAbi(["function getOrder(uint128 orderId) view returns ((uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs))"])
const nowNs = BigInt(Math.floor(Date.now() / 1000)) * 1_000_000_000n
const markets = (await gq('{ Market(where:{marketType:{_eq:"PERP"}}) { baseSymbol poolAddress } }')).Market
let shown = 0, totalPassed = 0
for (const m of markets) {
  // 1. Expired makers the indexer still lists as Open (lazy expiry: still stored in the pool).
  const exp = (await gq(`{ Order(where:{market_id:{_eq:"${m.poolAddress}"}, status:{_eq:"Open"}, rested:{_eq:true}, expireTimestampNs:{_lt:"${nowNs}"}}, limit: 200) { orderIdRaw isBid price expireTimestampNs } }`)).Order
  if (!exp.length) continue
  for (const side of [false, true]) { // false = expired asks (passed by taker buys), true = expired bids (passed by taker sells)
    const e = exp.filter((o: any) => o.isBid === side); if (!e.length) continue
    // best-priced expired maker on that side, and the latest expiry among those priced at least that well
    const best = e.reduce((a: any, b: any) => (side ? BigInt(b.price) > BigInt(a.price) : BigInt(b.price) < BigInt(a.price)) ? b : a)
    const lastExpSec = Number(BigInt(best.expireTimestampNs) / 1_000_000_000n) + 1
    // 2. A taker on the other side that filled at a WORSE price than that maker, after it expired.
    const cmp = side ? `_lt:"${best.price}"` : `_gt:"${best.price}"`
    const fills = (await gq(`{ Fill(where:{market_id:{_eq:"${m.poolAddress}"}, takerIsBid:{_eq:${!side}}, timestamp:{_gte:"${lastExpSec}"}, fillPrice:{${cmp}}}, order_by:{id:asc}, limit: 1) { fillPrice txHash blockNumber timestamp takerOrderId } }`)).Fill
    if (!fills.length) continue
    const fl = fills[0]
    const rc = await c.getTransactionReceipt({ hash: fl.txHash })
    // 3. The expired maker was still stored one block before that fill, and still has its full size.
    const o: any = await c.readContract({ address: m.poolAddress, abi, functionName: "getOrder", args: [BigInt(best.orderIdRaw)], blockNumber: BigInt(fl.blockNumber) - 1n })
    const blk = await c.getBlock({ blockNumber: BigInt(fl.blockNumber) })
    const expiredThen = o.expireTimestampNs < blk.timestamp * 1_000_000_000n
    totalPassed++
    if (shown++ < 6) console.log(`${m.baseSymbol} expired ${side ? "bid" : "ask"} ${best.orderIdRaw} @ ${Number(best.price) / 1e18} (expired ${expiredThen}, stored at block ${BigInt(fl.blockNumber) - 1n}, qtyRemaining ${o.quantityRemaining}) | taker ${side ? "sell" : "buy"} filled @ ${Number(fl.fillPrice) / 1e18} in ${fl.txHash} block ${fl.blockNumber}: receipt ${rc.status}`)
  }
}
console.log("pools/sides where a taker filled past a stored expired maker without reverting:", totalPassed)
