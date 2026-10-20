// 015: the trader docs say the liquidation fee is "taken only from the surplus the close creates:
// an account that comes back just above maintenance margin pays nothing". The LiquidationEngine
// charges it (usually the full 1%) on closes that leave the account BELOW maintenance margin with
// the position still open. Read-only, no key.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 015-repro.mts [rows=400] [print=12]
import { createPublicClient, http, parseAbi, decodeEventLog, formatUnits } from "viem"
import { liquidationEngineEventsAbi, marginBankEventsAbi, MARGIN_STATUS } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => { const r = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (r.errors) throw new Error(JSON.stringify(r.errors)); return r.data }
const c = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const health = parseAbi(["function getAccountHealth(address account) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)"])
const f = (x: bigint, d = 6) => Number(formatUnits(x, 18)).toFixed(d)
const rows = Number(process.argv[2] ?? "400"), show = Number(process.argv[3] ?? "12")

// Liquidations whose own AccountLiquidated event says the account ended at PartialLiquidation (2) or CloseOut (3).
const al = (await gq(`{ LiquidationEvent(where:{kind:{_eq:"AccountLiquidated"}, marginStatusAfter:{_gte:2}}, order_by:{blockNumber:desc}, limit:${rows}) { account txHash } }`)).LiquidationEvent
console.log(`head ${await c.getBlockNumber()}; AccountLiquidated rows ending below maintenance (status after >= 2): ${al.length}`)
let charged = 0, total = 0n, printed = 0
const perAcct = new Map<string, { n: number; sum: bigint }>()
for (const r of al) {
  const rc = await c.getTransactionReceipt({ hash: r.txHash })
  let fee = 0n, notional = 0n, pool = "", liq: any = null, newSize: bigint | null = null
  for (const l of rc.logs) {
    let d: any; try { d = decodeEventLog({ abi: [...liquidationEngineEventsAbi, ...marginBankEventsAbi] as any, data: l.data, topics: l.topics }) } catch { continue }
    if (d.args?.account?.toLowerCase() !== r.account) continue
    if (d.eventName === "LiquidationFeeCharged") { fee += d.args.amount; notional += d.args.fillNotional; pool = d.args.perpPool }
    if (d.eventName === "AccountLiquidated") liq = d.args
    if (d.eventName === "PositionUpdated") newSize = d.args.newSize // last update of the account's position in this tx
  }
  if (fee === 0n || !liq) continue
  charged++; total += fee
  const p = perAcct.get(r.account) ?? { n: 0, sum: 0n }; p.n++; p.sum += fee; perAcct.set(r.account, p)
  if (printed < show) {
    printed++
    const [eq0, , mm0] = await c.readContract({ address: MB, abi: health, functionName: "getAccountHealth", args: [r.account], blockNumber: rc.blockNumber - 1n }) as any
    const [eq1, , mm1] = await c.readContract({ address: MB, abi: health, functionName: "getAccountHealth", args: [r.account], blockNumber: rc.blockNumber }) as any
    console.log(`block ${rc.blockNumber} tx ${r.txHash}\n  account ${r.account} pool ${pool}: AccountLiquidated status ${MARGIN_STATUS[liq.marginStatusBefore]} -> ${MARGIN_STATUS[liq.marginStatusAfter]}, positionsProcessed ${liq.positionsProcessed}, position left ${newSize}\n  LiquidationFeeCharged ${f(fee)} USDso on fillNotional ${f(notional, 2)} (${(Number(fee * 1_000_000n / notional) / 10_000).toFixed(4)}%)\n  equity - mmReq: block-1 ${f(eq0 - mm0)}, end of block ${f(eq1 - mm1)} (without the fee ${f(eq1 + fee - mm1)})`)
  }
}
console.log(`\nfee-charging liquidations that left the account below maintenance margin: ${charged} of ${al.length}; fees charged ${f(total)} USDso`)
for (const [a, p] of [...perAcct.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 5)) console.log(`  ${a}: ${p.n} such fees, ${f(p.sum)} USDso`)
process.exit(0)
