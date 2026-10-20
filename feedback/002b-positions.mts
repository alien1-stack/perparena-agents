import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const m: any = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394"
const pools: any = { NEAR: "0x1cD15ae8bFf0FE0a7F49233BE8b90734775bA454", XRP: "0x7058579F3248559963f79AdB937c6De9f953E060" }
const owners = ["0xFF3B35D2E03a0054aCEf3Aae71A460590b6C9713","0xD71Ed28806b9b982eaC36De11Fe941ECBeb3Ff50","0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF","0xC1DA1F512528b0b77C5fF199904951B7B9Dcf5b1"]
const j = (x: any) => JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v)
for (const [k, pool] of Object.entries(pools)) for (const a of owners) {
  try { const p = await m.client.getPerpPosition({ marginBank: MB, account: a, pool }); console.log(k, a.slice(0,8), j(p).slice(0,220)) } catch (e: any) { console.log(k, a.slice(0,8), "ERR", e.shortMessage || e.message) }
}
process.exit(0)
