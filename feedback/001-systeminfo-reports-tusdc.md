# `getSystemInfo().usdc` and `faucet()` report tUSDC on a perps setup whose margin is USDso

Severity: normal
Area: SDK

> Note: the perps docs already warn that `SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral` is a different token (Common pitfalls). This item is about the SDK surfaces that still expose that token with no warning: `getSystemInfo().usdc` and `faucet()`. Neither is mentioned in the pitfall.
## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, tsx.
## Summary
The perps testnet docs list **Collateral = `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` (USDso, 18 decimals)**, and the MarginBank agrees.
The SDK preset ships `collateral = 0x9E9492cC533E8696A3b6afC7df730800DF75148f` (**tUSDC, 6 decimals**). Every SDK helper that reads `addresses.collateral` therefore reports the wrong token for perps.

## Steps to reproduce
1. `npm i @somnia-chain/markets-sdk@0.32.1 viem`
2. Run:
```ts
const m = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES })
console.log(SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral)                       // 0x9E94…148f
console.log((await m.client.getSystemInfo()).usdc)                            // { symbol: "tUSDC", decimals: 6 }
console.log((await m.client.getPerpSystemConfig("0x478769E1177C0773c43A593DCCc4Ad15F15F1394")).collateralToken) // 0xed79…4F72 (USDso, 18)
```

## Expected
One collateral for perps. `getSystemInfo().usdc` (or a perps-specific field) should report USDso / 18 decimals, matching the docs and the MarginBank.

## Actual
- `getSystemInfo().usdc` = `{ symbol: "tUSDC", decimals: 6 }`.
- `faucet()` (src/testnet.ts:32) mints tUSDC, which can't be used as perps margin.
- Deposits still work, because `depositMargin` resolves the token from the bank (`w.bankCollateral(bank)` in src/perp/margin.ts:1480). So the mismatch is silent until a bot formats balances or approves with the preset address.

## Impact
A bot that formats balances or sizes orders using the system info's 6 decimals is off by 10^12 against an 18-decimal USDso balance. One that approves `addresses.collateral` approves the wrong token. AI agents copying the preset hit this first.

## Suggested fix
- Add `perpCollateral` to the preset (or set `collateral` per venue), and expose it in `getSystemInfo()`.
- Add one line to the docs: "perps margin = USDso (18 decimals); `faucet()` is for binary markets (tUSDC)."

## Evidence
- Repro script: `001-repro.mts` in this folder (read-only: view calls only, no key, nothing signed or sent). Run with `npx tsx 001-repro.mts` from a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx` installed. It replaces the ad-hoc probes we first used, which were never committed here.
- Output, 2026-10-20:
```
chainId 50383
SDK preset addresses.collateral : 0x9E9492cC533E8696A3b6afC7df730800DF75148f tUSDC 6 decimals
docs perps Collateral          : 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 USDso 18 decimals
getSystemInfo().usdc           : {"symbol":"tUSDC","decimals":6}
getPerpSystemConfig(MarginBank).collateralToken: 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 USDso 18 decimals
faucet() token resolution (src/testnet.ts:32): const testUsdc = p.testUsdc ?? a.collateral ?? a.testUsdc;
=> faucet() with the preset mints: 0x9E9492cC533E8696A3b6afC7df730800DF75148f tUSDC 6 decimals
```
- `depositMargin` resolving the token from the bank: `w.bankCollateral(bank, p.collateral)` at `src/perp/margin.ts:1480` of the published 0.32.1 package.
