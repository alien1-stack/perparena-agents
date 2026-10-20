// 018: MarginBank.getWithdrawableCollateral (= SDK getMarginAccount().withdrawable, "respects margin
// requirements") ignores initial margin. For any account with an open position, withdraw(thatAmount)
// reverts InsufficientMarginAfterWithdrawal. Read-only, no key: view calls + eth_call simulations of
// withdraw() with `from` = the account (nothing is signed or sent).
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 018-repro.mts [positions=150]
import { createPublicClient, http, parseAbi, encodeFunctionData, decodeErrorResult, formatUnits } from "viem"
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, contractErrorsAbi } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const G = "https://hideki-dev.smk.somnia.host/v1/graphql"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const c = createPublicClient({ transport: http(RPC) })
const sdk = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: G, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })
const gq = async (q: string) => (await (await fetch(G, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json()).data
const ab = parseAbi([
  "function getAccountHealth(address) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
  "function getAccountState(address) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getWithdrawableCollateral(address) view returns (uint256)",
  "function getCreditFloor(address) view returns (uint256)",
  "function withdraw(uint256 amount)",
])
const head = await c.getBlockNumber()
const f = (x: bigint) => Number(formatUnits(x, 18)).toFixed(4)
const rd = (fn: string, a: string) => c.readContract({ address: MB, abi: ab, functionName: fn as any, args: [a], blockNumber: head } as any) as Promise<any>
const tryWd = async (a: string, amt: bigint): Promise<string | null> => {
  try { await c.call({ to: MB, account: a as any, data: encodeFunctionData({ abi: ab, functionName: "withdraw", args: [amt] }), blockNumber: head }); return null }
  catch (e: any) { let d: any; e.walk((x: any) => { if (typeof x?.data === "string" && x.data.startsWith("0x")) d = x.data; return false }); try { return decodeErrorResult({ abi: contractErrorsAbi as any, data: d }).errorName } catch { return String(d) } }
}
console.log(`head ${head}, MarginBank ${MB}`)

// 1. Accounts holding an open position (most recently updated first).
const N = Number(process.argv[2] ?? 150)
const rows = (await gq(`{ PerpPosition(where:{size:{_neq:"0"}}, order_by:{updatedAtBlock:desc}, limit:${N}){ account } }`)).PerpPosition
const accts = [...new Set(rows.map((r: any) => r.account))] as string[]
let n = 0, ok = 0, rev = 0, eqUnl = 0, detailed = 0
const reasons: Record<string, number> = {}
for (const a of accts) {
  const [W, floor, st, h] = await Promise.all([rd("getWithdrawableCollateral", a), rd("getCreditFloor", a), rd("getAccountState", a), rd("getAccountHealth", a)])
  if (W === 0n) continue
  n++
  const unl = st.unlockedCollateralBalance as bigint
  if (W === unl - floor) eqUnl++
  const err = await tryWd(a, W)
  if (!err) { ok++; continue }
  rev++; reasons[err] = (reasons[err] ?? 0) + 1
  if (detailed >= 6) continue
  detailed++
  const [equity, imReq] = [h[0] as bigint, h[1] as bigint]
  let lo = 0n, hi = W // largest amount withdraw() accepts, to 1e-6 USDso
  for (let i = 0; i < 80 && hi - lo > 10n ** 12n; i++) { const mid = (lo + hi) / 2n; if (await tryWd(a, mid)) hi = mid; else lo = mid }
  const ma = await (sdk.client as any).getMarginAccount(MB, a)
  console.log(`${a} (${st.activePerpPools.length} open market(s)${floor > 0n ? ", paper-USDso floor " + f(floor) : ""})
    getWithdrawableCollateral ${f(W)}  (SDK getMarginAccount().withdrawable ${f(ma.withdrawable)})  = unlocked ${f(unl)} - creditFloor ${f(floor)}
    eth_call withdraw(${f(W)}) -> reverts ${err}
    largest withdraw() the bank accepts: ${f(lo)}   equity - imReq = ${f(equity)} - ${f(imReq)} = ${f(equity - imReq)}`)
}
console.log(`accounts with an open position and withdrawable > 0: ${n}; getWithdrawableCollateral == unlocked - creditFloor on ${eqUnl}/${n}; withdraw(withdrawable) succeeds ${ok}, reverts ${rev} ${JSON.stringify(reasons)}`)

// 2. Control: flat accounts (no open position). There the view is right.
const flat = (await gq(`{ PerpPosition(where:{size:{_eq:"0"}}, order_by:{updatedAtBlock:desc}, limit:60){ account } }`)).PerpPosition
let fn = 0, fok = 0
for (const a of [...new Set(flat.map((r: any) => r.account))] as string[]) {
  const st = await rd("getAccountState", a)
  if (st.activePerpPools.length !== 0) continue
  const W = await rd("getWithdrawableCollateral", a)
  if (W === 0n) continue
  fn++; if (!(await tryWd(a, W))) fok++
  if (fn >= 15) break
}
console.log(`control, flat accounts: withdraw(getWithdrawableCollateral) succeeds on ${fok}/${fn}`)
process.exit(0)
