import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const gq = async (q: string) => (await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })).json()).data
const m: any = new SomniaMarkets({ chain: hidekiTestnet as any, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const mk = (await gq('{ Market(where:{marketType:{_eq:"PERP"}}) { baseSymbol poolAddress } }')).Market
let tot = 0, bad = 0
for (const x of mk) {
  const p = x.poolAddress.toLowerCase()
  const d = await gq(`{ chain_metadata { latest_processed_block } PerpPosition(where:{pool:{_eq:"${p}"}, size:{_neq:"0"}}, order_by:{updatedAtBlock:asc}, limit: 25) { account size isLong entryFundingIndex updatedAtBlock } }`)
  for (const r of d.PerpPosition) {
    const pos = await m.client.getPerpPosition({ marginBank: MB, account: r.account, pool: p })
    tot++
    if (BigInt(pos.entryFundingIndex) !== BigInt(r.entryFundingIndex)) { bad++; if (bad <= 8) console.log("MISMATCH", x.baseSymbol, r.account, "indexer", r.entryFundingIndex, "chain", String(pos.entryFundingIndex), "row.updatedAtBlock", r.updatedAtBlock, "indexerHead", d.chain_metadata[0].latest_processed_block) }
  }
}
console.log(`checked ${tot} oldest-updated open positions across ${mk.length} pools; entryFundingIndex mismatches: ${bad}`)
process.exit(0)
