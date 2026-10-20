// 013: getMaxPerpOrderSize / previewPerpOrderMargin charge the account's leverage-setting surcharge on the
// target market only; the chain charges it on every market where the account's setting is stricter than
// the IMF. For such accounts the SDK "max" reverts InsufficientMarginForOrder. Read-only: the order is only
// simulated with eth_call (from = the account), nothing is signed or sent.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 013-repro.mts [account symbol]...
import { createPublicClient, http, parseAbi, decodeErrorResult } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, contractErrorsAbi } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => (await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json()).data
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const sdk: any = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const ab = parseAbi([
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getMaxLeverage(address account, address perpPool) view returns (uint16)", "function getCreditFloor(address account) view returns (uint256)", "function getVoucherLeverageCap() view returns (uint16)",
  "function getPosition(address account, address pool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
  "function getAccountHealth(address account) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
  "function tryGetHealthSnapshot() view returns (bool ok, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps) snapshot)",
  "function getOrderBookParameters() view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize)",
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable",
])
const markets = (await gq('{ Market(where:{marketType:{_eq:"PERP"}}) { baseSymbol poolAddress } }')).Market
const sym: Record<string, string> = {}; for (const m of markets) sym[m.poolAddress.toLowerCase()] = m.baseSymbol
const args = process.argv.slice(2)
const cases: [string, string][] = args.length ? Array.from({ length: args.length / 2 }, (_, i) => [args[2 * i], args[2 * i + 1]]) : [
  ["0x215e7d2e597a202f964b2a816c67eebc5a607897", "BTC"],
  ["0x3982e3930efd87fe1bad4cd66e2c1fb38f306501", "SUI"],
  ["0xd631b6253990e7669e8cb5100c375ed2f8142122", "AVAX"],
  ["0x34a9df25049ff6509e8c0d6aad36052764f1837d", "SOL"],
]
const NO_BUILDER = "0x0000000000000000000000000000000000000000"
for (const [a, s] of cases) {
  const pool = markets.find((m: any) => m.baseSymbol === s).poolAddress as `0x${string}`
  const [tick, , lot] = await c.readContract({ address: pool, abi: ab, functionName: "getOrderBookParameters" }) as any
  const [, snap0] = await c.readContract({ address: pool, abi: ab, functionName: "tryGetHealthSnapshot" }) as any
  const price = (snap0.markPrice * 97n / 100n) / tick * tick // PostOnly bid 3% under the mark: rests, no adverse-gap term
  // 1. What the SDK says, and a simulation of exactly that order at the SDK's own block.
  const mx = await sdk.client.getMaxPerpOrderSize({ pool, marginBank: MB, account: a, isBid: true, price, autoPull: true })
  const B = mx.asOfBlock as bigint
  const place = async (q: bigint) => {
    try { await c.simulateContract({ account: a as any, address: pool, abi: ab, functionName: "placeOrder", args: [true, 0n, price, q, 18446744073709551615n, 3, 0, NO_BUILDER, 0n], blockNumber: B }); return "ok" }
    catch (e: any) { const raw = e?.walk?.((x: any) => x?.data)?.data; try { return decodeErrorResult({ abi: contractErrorsAbi as any, data: raw }).errorName } catch { return "revert" } }
  }
  const atMax = await place(mx.maxQuantity)
  let lo = 0n, hi = (2n * mx.maxQuantity) / lot + 1n
  while (hi - lo > 1n) { const m = (lo + hi) / 2n; if ((await place(m * lot)) === "ok") lo = m; else hi = m }
  const chainMax = lo * lot
  // 2. The account's leverage surcharge on its OTHER markets, at the same block.
  const r = (fn: string, ar: any[] = [], address: string = MB) => c.readContract({ address: address as any, abi: ab, functionName: fn as any, args: ar, blockNumber: B } as any) as any
  const floor = await r("getCreditFloor", [a]); const vcap = await r("getVoucherLeverageCap")
  const st = await r("getAccountState", [a]); const [eq, imReq] = await r("getAccountHealth", [a])
  let other = 0n; const legs: string[] = []
  let tgt: any
  for (const p of new Set<string>([...st.activePerpPools.map((x: string) => x.toLowerCase()), pool.toLowerCase()])) {
    const [, sn] = await r("tryGetHealthSnapshot", [], p); const pos = await r("getPosition", [a, p])
    let lev = await r("getMaxLeverage", [a, p]); if (floor > 0n && (lev === 0 || lev > vcap)) lev = vcap
    const levBps = lev === 0 ? 0n : (10000n + BigInt(lev) - 1n) / BigInt(lev)
    const n = (pos.size < 0n ? -pos.size : pos.size) * sn.markPrice / sn.oneBase
    const extra = levBps > sn.effectiveIMFBps ? n * (levBps - sn.effectiveIMFBps) / 10000n : 0n
    if (p === pool.toLowerCase()) tgt = { sn, n, levBps }; else if (extra > 0n) { other += extra; legs.push(`${sym[p]} ${lev}x on ${Number(sn.effectiveIMFBps) / 100}% IMF: +${(Number(extra) / 1e18).toFixed(2)}`) }
  }
  // 3. The SDK rule vs the same rule with the other markets' surcharge added, solved on the lot grid.
  const fits = (q: bigint, extra: bigint) => { const add = q * price / tgt.sn.oneBase; const lock = add * tgt.sn.effectiveIMFBps / 10000n
    const sur = tgt.levBps > tgt.sn.effectiveIMFBps ? (tgt.n + add) * (tgt.levBps - tgt.sn.effectiveIMFBps) / 10000n : 0n; return eq - lock >= imReq + sur + extra }
  const solve = (extra: bigint) => { let l = 0n, h = (4n * mx.maxQuantity) / lot + 2n; while (h - l > 1n) { const m = (l + h) / 2n; if (fits(m * lot, extra)) l = m; else h = m } return l * lot }
  const pv = await sdk.client.previewPerpOrderMargin({ pool, marginBank: MB, account: a, isBid: true, price, quantity: mx.maxQuantity, autoPull: true })
  const pvSim = await (async () => { try { await c.simulateContract({ account: a as any, address: pool, abi: ab, functionName: "placeOrder", args: [true, 0n, price, mx.maxQuantity, 18446744073709551615n, 3, 0, NO_BUILDER, 0n], blockNumber: pv.asOfBlock }); return "ok" } catch (e: any) { const raw = e?.walk?.((x: any) => x?.data)?.data; try { return decodeErrorResult({ abi: contractErrorsAbi as any, data: raw }).errorName } catch { return "revert" } } })()
  console.log(`${s} ${a} block ${B}, PostOnly bid ${price} (mark ${snap0.markPrice})`)
  console.log(`  other-market leverage surcharge: ${legs.join("; ") || "none"}`)
  console.log(`  SDK getMaxPerpOrderSize: maxQuantity ${mx.maxQuantity} placeable ${mx.placeable} limitedBy ${mx.limitedBy}`)
  console.log(`  eth_call placeOrder(maxQuantity) @${B}: ${atMax}`)
  console.log(`  SDK previewPerpOrderMargin(maxQuantity) @${pv.asOfBlock}: sufficient ${pv.sufficient} meetsInitialMargin ${pv.meetsInitialMargin}; eth_call placeOrder @${pv.asOfBlock}: ${pvSim}`)
  console.log(`  largest size the chain accepts @${B}: ${chainMax} (SDK max is ${(Number(mx.maxQuantity - chainMax) * 100 / Number(chainMax)).toFixed(2)}% higher)`)
  console.log(`  rule solved @${B}: target-market surcharge only = ${solve(0n)}; plus other markets' surcharge = ${solve(other)}`)
}
process.exit(0)
