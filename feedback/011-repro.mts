// 011: liquidation fees are debited from the liquidated account and logged as going to an
// Insurance Fund tier, but no tier balance ever grows. Read-only, no key.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 011-repro.mts
import { createPublicClient, http, parseAbi, decodeEventLog } from "viem"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { marginBankEventsAbi, liquidationEngineEventsAbi, SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => { const r = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json(); if (r.errors) throw new Error(JSON.stringify(r.errors)); return r.data }
const c = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const ab = parseAbi([
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getTierBalance(uint256 tier) view returns (uint256)",
  "function getTotalTierBalances() view returns (uint256)",
  "function getMaxTiers() view returns (uint256)",
])
const fmt = (x: bigint) => (Number(x) / 1e18).toFixed(6)
const sdk: any = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const cfg = await sdk.client.getPerpSystemConfig(MB)
const IF = cfg.insuranceFund as `0x${string}`
const head = await c.getBlockNumber()
console.log(`head ${head}  InsuranceFund ${IF}  LiquidationEngine ${cfg.liquidationEngine}`)

// 1. Ledger totals: what was charged as LiquidationFee (indexer) vs what the tiers hold (chain).
const charged: Record<string, bigint> = {}; let n = 0
for (let off = 0; ; off += 1000) {
  const rows = (await gq(`{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFee"}}, order_by:{id:asc}, limit:1000, offset:${off}) { amount tier insurancePortion } }`)).PerpFeeRecord
  for (const r of rows) { charged[r.tier] = (charged[r.tier] ?? 0n) + BigInt(r.insurancePortion ?? r.amount); n++ }
  if (rows.length < 1000) break
}
const funded: Record<string, bigint> = {}; const kinds = new Set<string>()
for (const e of (await gq(`{ PerpInsuranceFundEvent(limit: 5000) { kind tier amount } }`)).PerpInsuranceFundEvent) {
  kinds.add(e.kind); if (e.kind === "TierFunded") funded[e.tier] = (funded[e.tier] ?? 0n) + BigInt(e.amount)
}
const maxT = await c.readContract({ address: IF, abi: ab, functionName: "getMaxTiers" })
console.log(`LiquidationFee rows: ${n}; InsuranceFund event kinds ever indexed: ${[...kinds].join(",")}`)
for (let t = 0n; t <= maxT; t++) {
  const bal = await c.readContract({ address: IF, abi: ab, functionName: "getTierBalance", args: [t], blockNumber: head })
  const k = String(t)
  if (bal === 0n && !charged[k] && !funded[k]) continue
  console.log(`tier ${t}: admin top-ups ${fmt(funded[k] ?? 0n)} + liquidation fees "to insurance" ${fmt(charged[k] ?? 0n)} = expected ${fmt((funded[k] ?? 0n) + (charged[k] ?? 0n))}; chain getTierBalance ${fmt(bal)}`)
}
const fundBank: any = await c.readContract({ address: MB, abi: ab, functionName: "getAccountState", args: [IF], blockNumber: head })
console.log(`getTotalTierBalances ${fmt(await c.readContract({ address: IF, abi: ab, functionName: "getTotalTierBalances", blockNumber: head }))}; InsuranceFund's own MarginBank balance ${fmt(fundBank.unlockedCollateralBalance)}`)

// 2. Per-transaction: the latest LiquidationFee txs. Fee leaves the trader, nothing arrives in the fund.
const recent = (await gq(`{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFee"}}, order_by:{timestamp:desc}, limit: ${Number(process.argv[2] ?? 3)}) { account amount tier txHash } }`)).PerpFeeRecord
const evAbi = [...marginBankEventsAbi, ...liquidationEngineEventsAbi] as any
for (const f of recent) {
  const r = await c.getTransactionReceipt({ hash: f.txHash })
  const b = r.blockNumber
  let pnl = 0n, funding = 0n, fee = 0n, feeTier = -1n, ifLogs = 0
  for (const l of r.logs) {
    if (l.address.toLowerCase() === IF.toLowerCase()) ifLogs++
    let d: any; try { d = decodeEventLog({ abi: evAbi, data: l.data, topics: l.topics }) } catch { continue }
    if (d.args.account?.toLowerCase() !== f.account) continue
    if (d.eventName === "PositionUpdated") pnl += d.args.realizedPnl
    if (d.eventName === "FundingSettled") funding += d.args.payment
    if (d.eventName === "LiquidationFeeCharged") { fee += d.args.amount; feeTier = d.args.tier }
  }
  const acct = async (blk: bigint) => ((await c.readContract({ address: MB, abi: ab, functionName: "getAccountState", args: [f.account], blockNumber: blk })) as any).unlockedCollateralBalance as bigint
  const tierBal = (blk: bigint) => c.readContract({ address: IF, abi: ab, functionName: "getTierBalance", args: [feeTier], blockNumber: blk })
  const fb = async (blk: bigint) => ((await c.readContract({ address: MB, abi: ab, functionName: "getAccountState", args: [IF], blockNumber: blk })) as any).unlockedCollateralBalance as bigint
  const [a0, a1, t0, t1, f0, f1] = await Promise.all([acct(b - 1n), acct(b), tierBal(b - 1n), tierBal(b), fb(b - 1n), fb(b)])
  console.log(`tx ${f.txHash} block ${b}`)
  console.log(`  liquidated ${f.account}: LiquidationFeeCharged ${fmt(fee)} to tier ${feeTier}; realizedPnl ${fmt(pnl)}; funding paid ${fmt(funding)}`)
  console.log(`  account unlocked collateral ${fmt(a0)} -> ${fmt(a1)} (delta ${fmt(a1 - a0)}; pnl - funding - fee = ${fmt(pnl - funding - fee)})`)
  console.log(`  InsuranceFund tier ${feeTier} balance ${fmt(t0)} -> ${fmt(t1)} (delta ${fmt(t1 - t0)}); fund's MarginBank balance delta ${fmt(f1 - f0)}; logs emitted by InsuranceFund in this tx: ${ifLogs}`)
}
process.exit(0)
