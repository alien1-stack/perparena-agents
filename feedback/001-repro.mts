// 001: the SDK preset's `collateral` (used by getSystemInfo().usdc and faucet()) is tUSDC (6 decimals),
// while the perps MarginBank's collateral is USDso (18 decimals). Read-only, no key, no transactions.
// Run from a project with @somnia-chain/markets-sdk@0.32.1, viem, tsx:  npx tsx 001-repro.mts
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { createPublicClient, http, erc20Abi } from "viem"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const U = "https://hideki-dev.smk.somnia.host/v1/graphql"
const MB = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const
const DOC_COLLATERAL = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const // "Collateral" on the perps-testnet docs page

const pub = createPublicClient({ chain: hidekiTestnet as any, transport: http(RPC) })
console.log("chainId", await pub.getChainId())
const tok = async (a: `0x${string}`) => {
  const [symbol, decimals] = await Promise.all([
    pub.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }),
    pub.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
  ])
  return `${a} ${symbol} ${decimals} decimals`
}

const preset = SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral as `0x${string}`
console.log("SDK preset addresses.collateral :", await tok(preset))
console.log("docs perps Collateral          :", await tok(DOC_COLLATERAL))

const m: any = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: U, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const sys = await m.client.getSystemInfo()
console.log("getSystemInfo().usdc           :", JSON.stringify(sys.usdc))
const cfg = await m.client.getPerpSystemConfig(MB)
console.log("getPerpSystemConfig(MarginBank).collateralToken:", await tok(cfg.collateralToken))

// faucet(): which token it targets. Print the resolution line from the installed SDK source (src/testnet.ts).
const req = createRequire(import.meta.url)
let sdkRoot = dirname(req.resolve("@somnia-chain/markets-sdk"))
while (!existsSync(join(sdkRoot, "package.json"))) sdkRoot = dirname(sdkRoot)
const src = readFileSync(join(sdkRoot, "src", "testnet.ts"), "utf8").split("\n")
const i = src.findIndex((l) => l.includes("const testUsdc = p.testUsdc ?? a.collateral"))
console.log(`faucet() token resolution (src/testnet.ts:${i + 1}):`, src[i]?.trim())
console.log("=> faucet() with the preset mints:", await tok((SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral ?? (SOMNIA_HIDEKI_TESTNET_ADDRESSES as any).testUsdc) as `0x${string}`))
process.exit(0)
