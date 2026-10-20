// 016: two liquidation outcomes the deployed LiquidationEngine emits, and the indexer serves,
// are missing from the SDK: `TakeoverBandClamped` and the skipped-liquidation-fee event.
// Read-only, no key. Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:
//   npx tsx 016-repro.mts [blocks=30000]
import { createPublicClient, http, toEventSelector, decodeEventLog } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import * as sdk from "@somnia-chain/markets-sdk"
const { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, liquidationEngineEventsAbi, LIQUIDATION_KIND, isLiquidationKind } = sdk as any
const LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => { const r = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (r.errors) throw new Error(JSON.stringify(r.errors)); return r.data }
const c = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const m = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })

// 1. Every topic0 the LiquidationEngine emitted in the window, against every event fragment the SDK exports.
const known = new Map<string, string>()
for (const [k, v] of Object.entries(sdk)) if (Array.isArray(v)) for (const x of v as any[]) if (x?.type === "event") known.set(toEventSelector(x), `${x.name} (${k})`)
const head = await c.getBlockNumber(); const span = BigInt(process.argv[2] ?? "30000")
const seen = new Map<string, { n: number; tx: string }>()
for (let to = head; to > head - span; to -= 1000n) for (const l of await c.getLogs({ address: LE, fromBlock: to - 999n, toBlock: to })) { const t = l.topics[0]!; const e = seen.get(t); if (e) e.n++; else seen.set(t, { n: 1, tx: l.transactionHash! }) }
console.log(`head ${head}: LiquidationEngine topic0s in the last ${span} blocks`)
for (const [t, e] of seen) console.log(`  ${t.slice(0, 10)} x${e.n}  ${known.get(t) ?? "NOT DECODABLE WITH ANY SDK ABI"}  e.g. ${e.tx}`)
console.log(`liquidationEngineEventsAbi names: ${liquidationEngineEventsAbi.filter((x: any) => x.type === "event").map((x: any) => x.name).join(", ")}`)

// 2. The same two events as the indexer serves them.
const tb = (await gq(`{ LiquidationEvent(where:{kind:{_eq:"TakeoverBandClamped"}}, order_by:{blockNumber:desc}, limit: 3) { account pool price marketBound clampedBound blockNumber txHash } }`)).LiquidationEvent
const sk = (await gq(`{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFeeSkipped"}}, order_by:{timestamp:desc}, limit: 3) { account pool amount fillNotional skipReason requestedAmount txHash } }`)).PerpFeeRecord
console.log(`indexer LiquidationEvent kind TakeoverBandClamped, newest: ${JSON.stringify(tb)}`)
console.log(`indexer PerpFeeRecord kind LiquidationFeeSkipped, newest: ${JSON.stringify(sk)}`)
for (const [label, tx] of [["TakeoverBandClamped", tb[0]?.txHash], ["LiquidationFeeSkipped", sk[0]?.txHash]] as const) {
  if (!tx) continue
  const rc = await c.getTransactionReceipt({ hash: tx })
  for (const l of rc.logs) if (l.address.toLowerCase() === LE.toLowerCase() && !known.has(l.topics[0]!)) {
    let ok = "decodes"; try { decodeEventLog({ abi: liquidationEngineEventsAbi, data: l.data, topics: l.topics }) } catch (e: any) { ok = `decodeEventLog(liquidationEngineEventsAbi) throws ${e.name}` }
    console.log(`  ${label} tx ${tx}: LE log topic0 ${l.topics[0]} topics ${l.topics.slice(1).join(" ")} data ${l.data} -> ${ok}`)
  }
}

// 3. The SDK's typed surfaces.
console.log(`LIQUIDATION_KIND has TakeoverBandClamped: ${LIQUIDATION_KIND.includes("TakeoverBandClamped")}; isLiquidationKind("TakeoverBandClamped") = ${isLiquidationKind("TakeoverBandClamped")}`)
try { const r = await m.client.listLiquidations({ kind: "TakeoverBandClamped" as any, limit: 3 }); console.log(`listLiquidations({kind:"TakeoverBandClamped"}) -> ${r.length} rows`) } catch (e: any) { console.log(`listLiquidations({kind:"TakeoverBandClamped"}) throws ${e.name}: ${e.message.slice(0, 200)}`) }
const all = await m.client.listLiquidations({ account: tb[0]?.account, limit: 20 })
console.log(`listLiquidations({account:${tb[0]?.account}}) kinds: ${[...new Set(all.map((r: any) => r.kind))].join(", ")}`)
const fees = await m.client.listPerpFees({ kind: "LiquidationFeeSkipped", limit: 2 })
console.log(`listPerpFees({kind:"LiquidationFeeSkipped"}) row keys: ${Object.keys(fees[0] ?? {}).join(", ")}; has skipReason: ${"skipReason" in (fees[0] ?? {})}`)
process.exit(0)
