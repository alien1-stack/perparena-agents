// 003 repro — read-only. Needs viem + tsx. Prints each perp market's per-account position cap
// as a fraction of its open-interest cap, straight from the pool (getPerpPoolParameters).
import { createPublicClient, http, parseAbi, formatUnits } from "viem"
const pub = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const abi = parseAbi(["function getPerpPoolParameters() view returns ((uint256 initialMarginBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 maxOpenInterest, uint256 maxPositionSize, uint256 takerFeeBpsTimes1k, int256 makerFeeBpsTimes1k, uint256 insuranceFundShareBps))"])
async function main() {
  const r = await fetch("https://hideki-dev.smk.somnia.host/v1/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ Market(where:{marketType:{_eq:"PERP"}}, order_by:{baseSymbol:asc}){ baseSymbol poolAddress baseDecimals } }` }) })
  const markets = (await r.json()).data.Market
  const block = await pub.getBlockNumber()
  let tenth = 0
  console.log(`block ${block}`)
  for (const m of markets) {
    const p = await pub.readContract({ address: m.poolAddress, abi, functionName: "getPerpPoolParameters", blockNumber: block })
    const ratio = Number((p.maxPositionSize * 10000n) / p.maxOpenInterest) / 10000
    const isTenth = Math.abs(ratio - 0.1) < 0.005
    if (isTenth) tenth++
    console.log(`${m.baseSymbol.padEnd(9)} maxPositionSize ${formatUnits(p.maxPositionSize, m.baseDecimals).padEnd(12)} maxOpenInterest ${formatUnits(p.maxOpenInterest, m.baseDecimals).padEnd(14)} ratio ${ratio.toFixed(3)} ${isTenth ? "~1/10" : "NOT 1/10"}`)
  }
  console.log(`\n${tenth} of ${markets.length} markets have a position cap of ~1/10 of the OI cap`)
  process.exit(0)
}
main().catch((e) => { console.error("ERROR", e?.shortMessage || e?.message || e); process.exit(1) })
