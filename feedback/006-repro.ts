import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, perpPoolEventsAbi, marginBankEventsAbi, liquidationEngineEventsAbi, liveEventsAbi, orderBookEventsAbi, contractErrorsAbi } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { createPublicClient, http, toEventSelector, type AbiEvent } from "viem"
import * as SDK from "@somnia-chain/markets-sdk"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
async function main() {
  const pub = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
  const m = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
  const c: any = (m as any).client
  const sys = await c.getPerpSystemConfig(MB)
  console.log("SYS", JSON.stringify(sys, (_, v) => typeof v === "bigint" ? v.toString() : v))
  // all event abis exported by sdk
  const known = new Map<string, string>()
  for (const [k, v] of Object.entries(SDK)) if (/EventsAbi$|EventAbi$/i.test(k) && Array.isArray(v)) for (const e of v as any[]) if (e?.type === "event") { try { known.set(toEventSelector(e as AbiEvent), `${k}.${e.name}`) } catch {} }
  console.log("known event selectors", known.size)
  const head = await pub.getBlockNumber()
  const targets: Record<string, string> = { marginBank: MB, btcPool: "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0" }
  for (const [k, v] of Object.entries(sys)) if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) targets[k] = v
  for (const [name, addr] of Object.entries(targets)) {
    const counts = new Map<string, number>()
    for (let i = 0; i < 4; i++) {
      const to = head - BigInt(i * 1000); const from = to - 999n
      try { const logs = await pub.getLogs({ address: addr as any, fromBlock: from, toBlock: to }); for (const l of logs) counts.set(l.topics[0]!, (counts.get(l.topics[0]!) ?? 0) + 1) } catch (e: any) { console.log(name, "getLogs err", e.shortMessage?.slice(0, 100)); break }
    }
    const unk = [...counts].filter(([t]) => !known.has(t))
    console.log("ADDR", name, addr, "topics", counts.size, "unknown", unk.length, unk.map(([t, n]) => `${t}x${n}`).join(" "), "| known:", [...counts].filter(([t]) => known.has(t)).map(([t, n]) => `${known.get(t)!.split(".")[1]}x${n}`).join(" "))
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
