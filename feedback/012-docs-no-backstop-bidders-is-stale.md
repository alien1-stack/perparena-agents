# Docs say "No backstop bidders are registered on testnet", but the LiquidationEngine has one and it is taking positions over

Severity: normal
Area: docs

The trader page "Margin & Liquidations" (`/docs/trading/perps-testnet/margin-and-liquidations`, Liquidations section) describes the waterfall: book close → backstop bidder takeover → Insurance Fund → ADL. It then says:

> No backstop bidders are registered on testnet, so the later stages come in sooner.

On the perps testnet (Hideki, chain 50383) this is false. `LiquidationEngine.getBidderCount()` has returned 1 since block 24,364,494 (2026-10-15 18:14 UTC). The bidder `0xAF327764345c2f54C1F2bc3322D28E4f633793b9` has taken over three liquidated positions today (`PositionTakenOver` + `PositionTransferred` + `CloseOutMarginSettled` in one tx). The SDK's own `getLiquidationEngineConfig()` also reports `bidderCount: 1n`.

This matters for anyone who reasons about liquidation outcomes from the docs. A trader or keeper who reads the sentence expects a bankrupt position to skip straight to the Insurance Fund/ADL. In fact, a position under close-out margin can be transferred to a third-party bidder at the takeover price (`TakeoverBandClamped` bounds), and the account's remaining close-out margin goes with it.

## Steps to reproduce
1. Run `npx tsx 012-repro.mts` (read-only; `@somnia-chain/markets-sdk@0.32.1`, `viem`, `tsx`). It:
   - reads `getBidderCount()` / `getBidders()` on the LiquidationEngine at head;
   - binary-searches archive state for the first block with a registered bidder;
   - takes the indexed `LiquidationEvent` rows of kind `PositionTakenOver` and decodes each receipt on chain with the SDK's `liquidationEngineEventsAbi` + `marginBankEventsAbi`.
2. Compare with the sentence on the Margin & Liquidations page (also served at `https://app.testnet.dreamdex.io/llms-full.txt`).

## Expected
The docs match the deployment: either "one backstop bidder is registered on testnet" (and what a takeover means for the liquidated account), or no bidder registered.

## Actual
Run 1 (2026-10-20):
```
block 28547172: LiquidationEngine.getBidderCount() = 1, getBidders() = ["0xAF327764345c2f54C1F2bc3322D28E4f633793b9"]
getBidderCount: 0 at block 24364493, 1 at block 24364494 (first block with a registered bidder)
indexed PositionTakenOver events: 3
  block 28537567 tx 0x170891a3829d9362c44805fbbcf3ea8b02747c7c129a1cf57eeb1d00927f855e status success
    PositionTransferred
    PositionTakenOver(account 0x671846a0c593e8685342dae71Da9C25fD8b8ce16, bidder 0xAF327764345c2f54C1F2bc3322D28E4f633793b9, size -227770000000, takeoverPrice 110047200427667631389) from 0xa66d3c24ad4a389d863846905d8173e1017e9f4d
    CloseOutMarginSettled
    AccountLiquidated
  block 28537567 tx 0x40099b2c64df594961a4b113da8132795efd58cc15e67a9dced866ae4e8b3300 status success
    PositionTransferred
    PositionTakenOver(account 0x5e7A5481e91AeB199E974BCBa961a9Aee1A21436, bidder 0xAF327764345c2f54C1F2bc3322D28E4f633793b9, size -156920000000, takeoverPrice 110060603010221198940) from 0xa66d3c24ad4a389d863846905d8173e1017e9f4d
    CloseOutMarginSettled
    AccountLiquidated
  block 28535489 tx 0xeed95612916a94094a3791bcae20eccf0f729d606c70094394704eeaf99ab431 status success
    PositionTransferred
    PositionTakenOver(account 0xc01592F1004EA02C6010f142CE430A31E4eE0D94, bidder 0xAF327764345c2f54C1F2bc3322D28E4f633793b9, size -32429000000000000000, takeoverPrice 2510197536734438743591) from 0xa66d3c24ad4a389d863846905d8173e1017e9f4d
    CloseOutMarginSettled
    AccountLiquidated
```
Run 2 (block 28552065): identical bidder, the same first-registration block 24364494, and the same three takeovers.

`block 24364494` timestamp: 2026-10-15 18:14:43 UTC.

## Suggested fix
Replace the sentence with the current state ("one backstop bidder is registered on testnet; a position below close-out margin can be taken over by it at a price inside the takeover band, before the Insurance Fund is used"). Or say the docs reflect a configuration that can change, and point to `client.getLiquidationEngineConfig(...).bidderCount`.

## Evidence
Outputs above. `012-repro.mts` is in this folder.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, docs checked 2026-10-20, read-only.
