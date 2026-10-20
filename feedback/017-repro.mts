// 017: PERPS.md says the LiquidationEngine "is deployed and indexed from block 436,735,800".
// On the perps testnet (chain 50383) that block is ~15x past the chain head. Read-only, no key.
// Run from a project with viem, tsx:  npx tsx 017-repro.mts
import { createPublicClient, http, toHex } from "viem"
const LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const DOC_BLOCK = 436_735_800n
const c = createPublicClient({ transport: http(RPC) })
const gq = async (q: string) => { const r = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (r.errors) throw new Error(JSON.stringify(r.errors)); return r.data }
const head = await c.getBlockNumber()
console.log(`chain ${await c.getChainId()} head ${head}; PERPS.md block ${DOC_BLOCK} is ${(Number(DOC_BLOCK) / Number(head)).toFixed(1)}x the head`)
// What a backfill that uses the documented block gets:
const raw = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: LE, fromBlock: toHex(DOC_BLOCK), toBlock: toHex(DOC_BLOCK + 1000n) }] }) })).json()
console.log(`eth_getLogs(LiquidationEngine, ${DOC_BLOCK}..+1000) -> ${JSON.stringify(raw.error ?? raw.result)}`)
// Where the contract actually starts (bytecode present), by binary search on archive state.
const has = async (b: bigint) => { try { return ((await c.getCode({ address: LE, blockNumber: b })) ?? "0x") !== "0x" } catch { return false } }
let lo = 1n, hi = head
while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (await has(mid)) hi = mid; else lo = mid }
console.log(`LiquidationEngine bytecode: absent/unavailable at ${lo}, present at ${hi}`)
const first = (await gq(`{ LiquidationEvent(order_by:{blockNumber:asc}, limit:1) { kind blockNumber txHash } }`)).LiquidationEvent[0]
console.log(`first indexed LiquidationEvent: ${JSON.stringify(first)}`)
process.exit(0)
