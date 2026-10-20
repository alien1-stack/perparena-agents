// 014: the trader docs say a paper-USDso (voucher) account's leverage setting "can't be changed"
// while the voucher remains. On chain, voucher accounts change it freely. Read-only, no key:
// getLogs + eth_call (incl. eth_call simulations with `from` = a voucher account, nothing is signed).
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 014-repro.mts [blocks=20000]
import { createPublicClient, http, parseAbi, parseAbiItem, encodeFunctionData, decodeErrorResult, formatUnits } from "viem"
import { contractErrorsAbi } from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const c = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") })
const ab = parseAbi([
  "function getCreditGranter() view returns (address)",
  "function getCreditFloor(address) view returns (uint256)",
  "function getVoucherLeverageCap() view returns (uint16)",
  "function getMaxLeverage(address account, address perpPool) view returns (uint16)",
  "function voucherExpiryOf(address) view returns (uint64)",
  "function setMaxLeverage(address perpPool, uint16 leverageX)",
])
const ev = parseAbiItem("event MaxLeverageSet(address indexed account, address indexed perpPool, uint16 leverageX)")
const head = await c.getBlockNumber()
const span = BigInt(process.argv[2] ?? "20000")
const rd = (fn: string, args: any[], blockNumber: bigint, address: any = MB) => c.readContract({ address, abi: ab, functionName: fn as any, args, blockNumber } as any) as Promise<any>
const vd = await rd("getCreditGranter", [], head)
console.log(`head ${head}; MarginBank.getCreditGranter() = ${vd}; getVoucherLeverageCap() = ${await rd("getVoucherLeverageCap", [], head)}`)

// 1. Every MaxLeverageSet in the window, with the account's voucher state just before it.
let n = 0, nVoucher = 0
const samples: { account: any; pool: any }[] = []
for (let to = head; to > head - span; to -= 1000n) {
  const logs = await c.getLogs({ address: MB, event: ev, fromBlock: to - 999n, toBlock: to })
  for (const l of logs) {
    const { account, perpPool, leverageX } = l.args as any
    const pre = l.blockNumber! - 1n
    const floor: bigint = await rd("getCreditFloor", [account], pre)
    const levBefore = await rd("getMaxLeverage", [account, perpPool], pre)
    const levAfter = await rd("getMaxLeverage", [account, perpPool], l.blockNumber!)
    const rc = await c.getTransactionReceipt({ hash: l.transactionHash! })
    n++; if (floor > 0n) { nVoucher++; samples.push({ account, pool: perpPool }) }
    console.log(`block ${l.blockNumber} tx ${l.transactionHash} status ${rc.status} account ${account} pool ${perpPool} leverage ${levBefore} -> ${levAfter} (event ${leverageX}x) | voucher floor before: ${formatUnits(floor, 18)} USDso`)
  }
}
console.log(`MaxLeverageSet events in the last ${span} blocks: ${n}; set by an account holding an active voucher (creditFloor > 0): ${nVoucher}`)

// 2. Same call simulated at head from voucher accounts: tighten and loosen. No VoucherAccountLeverageLocked.
const seen = new Set<string>()
for (const s of samples) {
  if (seen.has(s.account) || seen.size >= 3) continue; seen.add(s.account)
  const floor: bigint = await rd("getCreditFloor", [s.account], head)
  if (floor === 0n) continue
  const out: string[] = []
  for (const lev of [1, 2, 10, 20, 21]) {
    try { await c.call({ to: MB, account: s.account, data: encodeFunctionData({ abi: ab, functionName: "setMaxLeverage", args: [s.pool, lev] }), blockNumber: head }); out.push(`${lev}x ok`) }
    catch (e: any) { let d: any; e.walk((x: any) => { if (typeof x?.data === "string" && x.data.startsWith("0x")) d = x.data; return false }); let name = d; try { name = decodeErrorResult({ abi: contractErrorsAbi as any, data: d }).errorName } catch {} out.push(`${lev}x reverts ${name}`) }
  }
  console.log(`eth_call setMaxLeverage from voucher account ${s.account} (creditFloor ${formatUnits(floor, 18)}, voucherExpiryOf ${await rd("voucherExpiryOf", [s.account], head, vd)}, current ${await rd("getMaxLeverage", [s.account, s.pool], head)}x) on pool ${s.pool}: ${out.join(", ")}`)
}
process.exit(0)
