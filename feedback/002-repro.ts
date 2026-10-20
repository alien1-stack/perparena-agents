// 002 repro — read-only. Run from any folder with viem + @somnia-chain/markets-sdk@0.32.1 + tsx installed:
//   npx tsx 002-repro.ts            -> scans all 21 perp books at one pinned block for bestAsk <= bestBid
//   npx tsx 002-repro.ts max        -> getMaxPerpOrderSize for a funded account vs. the market-wide OI headroom
//   npx tsx 002-repro.ts <txHash>   -> decodes a placeOrder sent through a Safe and prints the book at the parent block
import { createPublicClient, http, parseAbi, formatUnits, decodeFunctionData, decodeEventLog } from "viem"
import * as sdk from "@somnia-chain/markets-sdk"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const IDX = "https://hideki-dev.smk.somnia.host/v1/graphql"
const pub = createPublicClient({ transport: http(RPC) })
const poolAbi = parseAbi([
  "function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])",
  "function getOpenInterest() view returns (uint256)",
  "function getPerpPoolParameters() view returns ((uint256 initialMarginBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 maxOpenInterest, uint256 maxPositionSize, uint256 takerFeeBpsTimes1k, int256 makerFeeBpsTimes1k, uint256 insuranceFundShareBps))",
  "function getAllOpenOrdersOffChain(bool isBid, uint256 maxCount, uint64 startCursor) view returns ((uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs)[] orders, bool hasMoreOrders, uint64 nextCursor)",
])
const safeAbi = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)"])
const sdkAbi: any[] = Object.entries(sdk).filter(([k, v]) => Array.isArray(v) && /abi/i.test(k)).flatMap(([, v]) => v as any[])
const j = (x: any) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v))

async function scan() {
  const r = await fetch(IDX, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ Market(where:{marketType:{_eq:"PERP"}}){ baseSymbol poolAddress baseDecimals quoteDecimals } }` }) })
  const markets = (await r.json()).data.Market
  const block = await pub.getBlock()
  const nowNs = block.timestamp * 1_000_000_000n
  console.log(`block ${block.number} ts ${block.timestamp} (${new Date(Number(block.timestamp) * 1000).toISOString()})`)
  for (const m of markets) {
    const pool = m.poolAddress
    const [bids, asks] = await Promise.all([true, false].map((s) => pub.readContract({ address: pool, abi: poolAbi, functionName: "getBookLevels", args: [s, 3n], blockNumber: block.number })))
    const bb = bids[0]?.price, ba = asks[0]?.price
    const crossed = bb !== undefined && ba !== undefined && ba <= bb
    const [oi, pp] = await Promise.all([pub.readContract({ address: pool, abi: poolAbi, functionName: "getOpenInterest", blockNumber: block.number }), pub.readContract({ address: pool, abi: poolAbi, functionName: "getPerpPoolParameters", blockNumber: block.number })])
    const oiInfo = `OI ${formatUnits(oi, m.baseDecimals)} / maxOI ${formatUnits(pp.maxOpenInterest, m.baseDecimals)} (headroom ${formatUnits(pp.maxOpenInterest - oi, m.baseDecimals)})`
    console.log(`${m.baseSymbol.padEnd(9)} ${oiInfo}  bestBid ${bb === undefined ? "-" : formatUnits(bb, 18)}  bestAsk ${ba === undefined ? "-" : formatUnits(ba, 18)}  ${crossed ? "CROSSED" : "ok"}`)
    if (!crossed) continue
    for (const isBid of [true, false]) {
      const res = await pub.readContract({ address: pool, abi: poolAbi, functionName: "getAllOpenOrdersOffChain", args: [isBid, 500n, 0n], blockNumber: block.number })
      for (const o of res[0].filter((o) => (isBid ? o.price >= ba! : o.price <= bb!)))
        console.log(`   ${isBid ? "BID" : "ASK"} order ${o.orderId} owner ${o.owner} price ${formatUnits(o.price, 18)} qtyRemaining ${formatUnits(o.quantityRemaining, m.baseDecimals)} ${o.expireTimestampNs < nowNs ? "EXPIRED" : "not expired"}`)
    }
  }
}

async function tx(h: `0x${string}`) {
  const t = await pub.getTransaction({ hash: h }), rc = await pub.getTransactionReceipt({ hash: h })
  const [to, , data] = decodeFunctionData({ abi: safeAbi, data: t.input }).args as any
  const inner = decodeFunctionData({ abi: sdkAbi.filter((x) => x.type === "function"), data })
  console.log(`tx ${h} block ${rc.blockNumber} status ${rc.status}\n  Safe -> pool ${to} ${inner.functionName} ${j(inner.args)}  (args: isBid, userData, price, quantity, expireNs, orderType[0=Limit], selfMatch, builder, builderFee)`)
  const parent = rc.blockNumber - 1n
  const [b, a] = await Promise.all([true, false].map((s) => pub.readContract({ address: to, abi: poolAbi, functionName: "getBookLevels", args: [s, 3n], blockNumber: parent })))
  const [oi, pp] = await Promise.all([pub.readContract({ address: to, abi: poolAbi, functionName: "getOpenInterest", blockNumber: parent }), pub.readContract({ address: to, abi: poolAbi, functionName: "getPerpPoolParameters", blockNumber: parent })])
  console.log(`  OI at parent: ${oi} maxOI ${pp.maxOpenInterest} headroom ${pp.maxOpenInterest - oi} (raw base units)`)
  console.log(`  book at parent block ${parent}: bids ${b.map((l) => formatUnits(l.price, 18)).join(", ")} | asks ${a.map((l) => formatUnits(l.price, 18)).join(", ")}`)
  for (const l of rc.logs.filter((l) => l.address.toLowerCase() === to.toLowerCase())) {
    try { const d: any = decodeEventLog({ abi: sdkAbi.filter((x) => x.type === "event"), data: l.data, topics: l.topics }); console.log("  log", d.eventName, j(d.args).slice(0, 220)) } catch { }
  }
}

async function max() {
  const { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } = sdk as any
  const { hidekiTestnet } = await import("@somnia-chain/markets-sdk/chains")
  const m: any = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: IDX, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })
  const perps = await m.client.listPerpMarkets()
  const acct = "0xD71Ed28806b9b982eaC36De11Fe941ECBeb3Ff50"
  for (const s of ["XRP", "NEAR", "BTC"]) {
    const mk = perps.find((x: any) => x.baseSymbol === s)
    const rp = await m.client.getPerpRiskParams(mk.poolAddress), st = await m.client.getPerpState(mk.poolAddress)
    const r = await m.client.getMaxPerpOrderSize({ pool: mk.poolAddress, marginBank: mk.marginBank, account: acct, isBid: true, price: (st.markPrice / BigInt(mk.tickSize)) * BigInt(mk.tickSize) })
    console.log(`${s} buy  placeable ${r.placeable} maxQuantity ${formatUnits(r.maxQuantity, mk.baseDecimals)} increasing ${formatUnits(r.increasingQuantity, mk.baseDecimals)} limitedBy ${r.limitedBy} | OI headroom ${formatUnits(rp.maxOpenInterest - st.openInterest, mk.baseDecimals)}`)
  }
}

;(process.argv[2] === "max" ? max() : process.argv[2] ? tx(process.argv[2] as any) : scan()).then(() => process.exit(0)).catch((e) => { console.error("ERROR", e?.shortMessage || e?.message || e); process.exit(1) })
