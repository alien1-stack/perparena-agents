// 008: MarginBank.getBankruptcyPrice ignores equity for any position not at a loss.
// Read-only. Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 008-repro.mts [perPool=8]
import { createPublicClient, http, parseAbi } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { perpLiquidationPrice } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const abi = parseAbi([
  "function getSideHoldersPaginated(address pool, bool isLong, uint256 start, uint256 count) view returns (address[])",
  "function getBankruptcyPrice(address account, address perpPool) view returns (uint256 price)", // what client.getBankruptcyPrice reads, verbatim
  "function getAccountHealth(address account) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
  "function getPosition(address account, address pool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
  "function getHealthSnapshot() view returns ((uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps) snapshot)",
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
])
const per = Number(process.argv[2] ?? 8)
const markets = (await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: '{ Market(where:{marketType:{_eq:"PERP"}}) { baseSymbol poolAddress } }' }) })).json()).data.Market
const B = await c.getBlockNumber()
const f = (x: bigint) => (Number(x) / 1e18).toPrecision(7)
const st = { singleMarketPositions: 0, inProfit: 0, inProfit_bankruptcyEqualsEntry: 0, atLoss: 0, atLoss_bankruptcyEqualsEntryMinusCollateral: 0, unexplained: 0, sdkLiqPriceBeyondChainBankruptcy_inProfit: 0, sdkLiqPriceBeyondChainBankruptcy_atLoss: 0 }
const examples: string[] = []
for (const m of markets) {
  let n = 0
  for (const isLong of [true, false]) {
    const holders = await c.readContract({ address: MB, abi, functionName: "getSideHoldersPaginated", args: [m.poolAddress, isLong, 0n, 200n], blockNumber: B }) as readonly `0x${string}`[] // = client.getPerpSideHolders, first page
    for (const acct of holders.slice(0, per)) {
      const [pos, h, snap, as] = await Promise.all([
        c.readContract({ address: MB, abi, functionName: "getPosition", args: [acct, m.poolAddress], blockNumber: B }),
        c.readContract({ address: MB, abi, functionName: "getAccountHealth", args: [acct], blockNumber: B }),
        c.readContract({ address: m.poolAddress, abi, functionName: "getHealthSnapshot", blockNumber: B }),
        c.readContract({ address: MB, abi, functionName: "getAccountState", args: [acct], blockNumber: B }),
      ]) as any
      if (as.activePerpPools.length !== 1) continue // single-market accounts only: all equity belongs to this one position
      const bk = await c.readContract({ address: MB, abi, functionName: "getBankruptcyPrice", args: [acct, m.poolAddress], blockNumber: B }) as bigint
      st.singleMarketPositions++
      const long = pos.size > 0n, abs = long ? pos.size : -pos.size, sg = long ? -1n : 1n
      const [eq, , mm] = h
      const entry: bigint = pos.avgEntryPrice, mark: bigint = snap.markPrice
      const collateralGone = entry + sg * as.unlockedCollateralBalance * snap.oneBase / abs // price where collateral + uPnL = 0
      const equityZero = mark + sg * eq * snap.oneBase / abs // price where getAccountHealth.equity = 0
      const liq = perpLiquidationPrice({ equity: eq, mmReq: mm, size: pos.size, markPrice: mark, maintenanceMarginBps: snap.maintenanceMarginBps, oneBase: snap.oneBase })!
      const profit = long ? mark >= entry : mark <= entry
      if (bk > 1n && liq > 0n && (long ? liq < bk : liq > bk)) { /* ignore both clamped at zero */ if (profit) st.sdkLiqPriceBeyondChainBankruptcy_inProfit++; else { st.sdkLiqPriceBeyondChainBankruptcy_atLoss++; console.log("  at-loss, liq beyond bankruptcy:", m.baseSymbol, acct, long ? "LONG" : "SHORT", "entry", f(entry), "mark", f(mark), "bk", f(bk), "liq", f(liq), "equityZero", f(equityZero)) } }
      const near = (a: bigint, b: bigint) => { const d = a > b ? a - b : b - a; return d <= 2n || d * 1_000_000n <= b }
      if (profit) { st.inProfit++; if (bk === entry) st.inProfit_bankruptcyEqualsEntry++; else st.unexplained++ }
      else { st.atLoss++; const cg = collateralGone < 0n ? 0n : collateralGone; if (near(bk, cg) || (cg === 0n && bk <= 1n)) st.atLoss_bankruptcyEqualsEntryMinusCollateral++; else st.unexplained++ }
      if (profit && examples.length < 6 && eq > 0n) examples.push(`${m.baseSymbol} ${acct} ${long ? "LONG" : "SHORT"} size=${Number(abs) / Number(snap.oneBase)} entry=${f(entry)} mark=${f(mark)} equity=${f(eq)} | getBankruptcyPrice=${f(bk)}  equity-zero price=${f(equityZero)}  getLiquidationPrice math=${f(liq)}`)
      if (++n >= per) break
    }
    if (n >= per) break
  }
}
console.log("block", B)
for (const e of examples) console.log(" ", e)
console.log(st)
