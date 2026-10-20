# Docs say a paper-USDso account's leverage setting "can't be changed" while the voucher remains, but voucher accounts change it on chain in both directions

Severity: normal
Area: docs

The trader page "Margin & Liquidations" (`/docs/trading/perps-testnet/margin-and-liquidations`, section Paper USDso) lists the rules that apply while any of the 1,000 USDso Perps Arena credit remains in the account:

> - **Your leverage setting can't be changed** while it remains.

On the perps testnet (Hideki, chain 50383) this is not what the MarginBank does. `MarginBank.setMaxLeverage(perpPool, leverageX)` succeeds for accounts that hold an active voucher (`getCreditFloor(account) > 0`). In the last 20,000 blocks, every one of the 10 `MaxLeverageSet` events came from such an account. They both tightened the setting (SOL/BTC 20x → 10x) and loosened it (ZEC 1x → 5x). An `eth_call` simulation from the same accounts accepts any value from 1x to 20x. The only rejections are `InvalidLeverage` above 20x and `NoStateChange` for the current value, which are the same rules as on a non-voucher account. The `VoucherAccountLeverageLocked` error is in the SDK's `contractErrorsAbi`, but it is never raised.

The SDK describes the real rule. `PerpLeverage.voucherLeverageCapX` TSDoc (`src/perp/margin.ts:672-708`) says the voucher cap "REPLACES an unset or looser account setting" and "a STRICTER user setting still wins". PERPS.md (`getPerpLeverage` section) says the same. So the voucher caps *effective* leverage at `getVoucherLeverageCap()` (20 today). It does not freeze the account's own setting.

Why it matters: the trader docs are the page Perps Arena players read. A player holding the credit who wants to lower risk (for example, to set 5x on a 20x market, which raises the initial margin an order needs) is told the control is locked. A bot builder may skip the `setPerpLeverage` call, or treat its success as a bug. The rule also reads as if the account is stuck at a fixed leverage, which the chain does not do.

## Steps to reproduce
1. Run `npx tsx 014-repro.mts [blocks]` (read-only: `eth_getLogs` and `eth_call` only, no key; `@somnia-chain/markets-sdk@0.32.1`, `viem`, `tsx`). It:
   - scans `MaxLeverageSet(account, perpPool, leverageX)` on the MarginBank over the window. For each event it reads `getCreditFloor(account)` and `getMaxLeverage(account, pool)` at `block − 1`, and `getMaxLeverage` again at `block`;
   - simulates `setMaxLeverage(pool, 1|2|10|20|21)` with `eth_call` from three of those voucher accounts at head, and decodes any revert with the SDK's `contractErrorsAbi`.
2. Compare with the Paper USDso rules on the Margin & Liquidations page (also served at `https://app.testnet.dreamdex.io/llms-full.txt`).

## Expected
Either the docs match the contract ("while the voucher remains, leverage is capped at 20x; you can still choose a lower setting"), or the contract rejects `setMaxLeverage` from a voucher account with `VoucherAccountLeverageLocked`, as the docs say.

## Actual
Run 1 (2026-10-20, head 28565794, window 20,000 blocks). Pools: `0x2a73…f050` ZEC, `0x4181…94c0` BTC, `0xD6Cb…eddf` ETH, `0xB483…FA53` SOL, `0xfA9B…6B6f` 1000PEPE, `0x7058…E060` XRP, `0x63B4…297A` HYPE.
```
head 28565794; MarginBank.getCreditGranter() = 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4; getVoucherLeverageCap() = 20
block 28557491 tx 0x5ab4bb08b66057857687bc54567a630fdc5ecc7e291d8e817b32f75a986a5564 status success account 0xd631B6253990e7669e8cb5100c375ED2F8142122 pool 0x2a73129F26917124bd2A47a9B355C395C537F050 leverage 1 -> 5 (event 5x) | voucher floor before: 2000 USDso
block 28557659 tx 0xf7100d6f6d8b867d8c3fc81afda74a3263f156446ce1561d2b5bad9906e69eb5 status success account 0xE0d908a689Ea60960668FA01876536c9b8B82100 pool 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0 leverage 0 -> 5 (event 5x) | voucher floor before: 2000 USDso
block 28556700 tx 0x11a323d78ce8bb6dfc2dcd727212ae48bf4c139b1e3028f8142eda03d12f39c3 status success account 0xE0d908a689Ea60960668FA01876536c9b8B82100 pool 0xD6Cb1DD58580B84D76068aC21594219ce03aeddf leverage 0 -> 5 (event 5x) | voucher floor before: 2000 USDso
block 28553953 tx 0x1e23d32471876b6bc6c19a32493491aa46444b4c05095262f1e647ff4ffc2eaf status success account 0x2d8B07bbfC92cF3A606b331D1c9385d46E7acAe8 pool 0xB483ec1fb34996638677c20ab087b16F1896FA53 leverage 0 -> 1 (event 1x) | voucher floor before: 1000 USDso
block 28554615 tx 0xf8e7388dc57367322934baf310765e7cafbf8c990370bbb90f5660cb1cc0df6b status success account 0x2d8B07bbfC92cF3A606b331D1c9385d46E7acAe8 pool 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0 leverage 0 -> 1 (event 1x) | voucher floor before: 1000 USDso
block 28552336 tx 0xfb0673d5e78eb731c9dbb7922721885d19d3317dab66fbd62623ed016ed0abff status success account 0xF6123d8ba7880619273162049AC50255abE970B4 pool 0xfA9B9e50CC1745113d57893991aF200a74c86B6f leverage 0 -> 3 (event 3x) | voucher floor before: 2000 USDso
block 28548875 tx 0x98c88b67d12d77eedf6045a1d3510a630535b32cc7884646d452f6072157358a status success account 0xE0d908a689Ea60960668FA01876536c9b8B82100 pool 0x7058579F3248559963f79AdB937c6De9f953E060 leverage 0 -> 2 (event 2x) | voucher floor before: 2000 USDso
block 28546824 tx 0x1aae32cd964254a1104691f67e633eea316a80c7cb262323451973d8bfd02a5a status success account 0x215E7D2e597A202f964b2a816C67EEbC5A607897 pool 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0 leverage 20 -> 10 (event 10x) | voucher floor before: 2000 USDso
block 28547343 tx 0x06a42aabb1dc95b06b7e0a03a0b6fff613705da0d48c869b3c8d201e3d55d04e status success account 0xE0d908a689Ea60960668FA01876536c9b8B82100 pool 0x63B47eD4A7DE0FdE659b0d82441dD74828b7297A leverage 0 -> 2 (event 2x) | voucher floor before: 2000 USDso
block 28546603 tx 0xad933e6a9033f64c8d5125981a2f429b610304cad7896e8d0d6d258e96549d8f status success account 0x215E7D2e597A202f964b2a816C67EEbC5A607897 pool 0xB483ec1fb34996638677c20ab087b16F1896FA53 leverage 20 -> 10 (event 10x) | voucher floor before: 2000 USDso
MaxLeverageSet events in the last 20000 blocks: 10; set by an account holding an active voucher (creditFloor > 0): 10
eth_call setMaxLeverage from voucher account 0xd631B6253990e7669e8cb5100c375ED2F8142122 (creditFloor 2000, voucherExpiryOf 1793634841, current 5x) on pool 0x2a73129F26917124bd2A47a9B355C395C537F050: 1x ok, 2x ok, 10x ok, 20x ok, 21x reverts InvalidLeverage
eth_call setMaxLeverage from voucher account 0xE0d908a689Ea60960668FA01876536c9b8B82100 (creditFloor 2000, voucherExpiryOf 1793634255, current 5x) on pool 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0: 1x ok, 2x ok, 10x ok, 20x ok, 21x reverts InvalidLeverage
eth_call setMaxLeverage from voucher account 0x2d8B07bbfC92cF3A606b331D1c9385d46E7acAe8 (creditFloor 1000, voucherExpiryOf 1793714013, current 1x) on pool 0xB483ec1fb34996638677c20ab087b16F1896FA53: 1x reverts NoStateChange, 2x ok, 10x ok, 20x ok, 21x reverts InvalidLeverage
```
Run 2 (head 28568663, window 25,000 blocks): the same 10 events, all from voucher accounts, and the same simulation results (`1x/2x/10x/20x ok`, `21x InvalidLeverage`, `NoStateChange` on the current value). A wider earlier scan also found `0xF19acF76c9886A38E271A758f558F9ad2e42c84F` setting 5x on LINK and NEAR (blocks 28541089 and 28541686) with a 1,999.55 USDso floor.

The pair at blocks 28557491 (ZEC 1x → 5x) and 28546603/28546824 (SOL and BTC 20x → 10x) shows the setting moving in both directions while the credit was active.

## Suggested fix
Replace the rule with what the contract does, for example: "While the credit remains, effective leverage is capped at 20x (`getVoucherLeverageCap`). You can still pick a lower setting, and it applies." If the intent really is to lock the setting, enforce `VoucherAccountLeverageLocked` in `setMaxLeverage` for accounts with `getCreditFloor > 0`, and update the SDK TSDoc that says a stricter setting "still wins".

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, VoucherDistributor 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4, RPC https://api.hideki2.infra.testnet.somnia.network, docs checked 2026-10-20 (llms-full.txt), read-only.
