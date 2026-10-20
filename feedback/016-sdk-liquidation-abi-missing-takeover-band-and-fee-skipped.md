# `liquidationEngineEventsAbi` cannot decode two liquidation outcomes the engine emits alongside many liquidations (`TakeoverBandClamped`, liquidation-fee skipped), and the SDK's kind vocabularies omit them

Severity: normal
Area: SDK

PERPS.md "Watch from chain (event ABIs)" tells bots to decode LiquidationEngine logs with `liquidationEngineEventsAbi`. The doc says it carries "the liquidation waterfall stages and their costs", and that "the signatures are pinned by topic0 against the compiled artifacts… Use the published ABI rather than a copy." The const's own TSDoc (`src/eventsAbi.ts:515-524`) lists the deliberate exclusions: owner-parameter `*Updated` events, bidder registration, and the ADL scan checkpoints (`AdlScanCheckpointed`, `AdlNoBadDebtToSocialize`).

The deployed LiquidationEngine (`0xA66d3C24…9F4D`) emits two more account-outcome events that are in neither the ABI nor the exclusion list. The deployed indexer already serves both:

| topic0 | Emitted | Indexed as | In the SDK |
|---|---|---|---|
| `0x83fa34f7…90d3be` | 24 times in 30,000 blocks, next to 59 `AccountLiquidated` events, including plain book closes with no takeover (e.g. tx `0x3d6e0f85…c676`, `stageReached` 1). Topics: account, pool. Data: 3 words | `LiquidationEvent.kind = "TakeoverBandClamped"` (`price`, `marketBound`, `clampedBound`) | not in `liquidationEngineEventsAbi`; not in `LIQUIDATION_KIND`, so `isLiquidationKind("TakeoverBandClamped") === false` and it is not a valid `kind` filter for TypeScript |
| `0xabddd757…ce991d` | 12 times in 30,000 blocks. Topics: account, pool, reason (`7`). Data: fill notional, 0 | `PerpFeeRecord.kind = "LiquidationFeeSkipped"` (`skipReason`, `requestedAmount`) | not in `liquidationEngineEventsAbi`; `PerpFeeRecord.kind` TSDoc lists only `Fee`, `Rebate`, `BuilderFee` and `LiquidationFee`; `listPerpFees` returns these rows but does not select `skipReason`/`requestedAmount`, so the caller gets an unexplained zero-amount "fee" |

(The third unknown topic0, `0x1d68b7d3…`, is `AdlNoBadDebtToSocialize(address,uint256)`. It is excluded on purpose and is not part of this report.)

Why it matters:
- A bot that follows the documented raw-watch path, `decodeEventLog({ abi: liquidationEngineEventsAbi, … })`, gets `AbiEventSignatureNotFoundError` for these logs. If it catches and skips (the usual pattern), it silently loses the clamp bounds and the fact that a liquidation fee was waived. With `viem.watchEvent` on the const, the logs never match.
- `LiquidationFeeSkipped` is the counterpart of `LiquidationFeeCharged`. A keeper or analytics tool that reconciles liquidation fees from chain (the PERPS.md cost-accounting use case) cannot tell "no fee because skipped, reason 7" apart from "event missed".
- The TypeScript `LiquidationKind` union rejects `"TakeoverBandClamped"` even though the indexer the SDK is pinned to writes it and `listLiquidations` returns it. A typed `switch (row.kind)` over `LiquidationKind` has no case for these rows.

## Steps to reproduce
1. Run `npx tsx 016-repro.mts [blocks]` (read-only, no key; `@somnia-chain/markets-sdk@0.32.1`, `viem`, `tsx`). It:
   - collects every topic0 the LiquidationEngine emitted in the window (`eth_getLogs`, 1,000-block chunks) and looks each up among every `type: "event"` fragment in every SDK export;
   - reads the newest indexed `TakeoverBandClamped` and `LiquidationFeeSkipped` rows, then decodes the LiquidationEngine logs in those transactions with `liquidationEngineEventsAbi`;
   - checks `LIQUIDATION_KIND` / `isLiquidationKind`, `listLiquidations`, and the keys `listPerpFees` returns.

## Expected
Either `liquidationEngineEventsAbi` includes the two events (and `LIQUIDATION_KIND` / the `PerpFeeRecord.kind` docs name them, with `skipReason` selected), or the const's TSDoc lists them as deliberately excluded and explains why.

## Actual
Run 1 (2026-10-20, head 28568437):
```
head 28568437: LiquidationEngine topic0s in the last 30000 blocks
  0x93081d01 x55  PositionLiquidated (liquidationEngineEventsAbi)  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0x7f65cfb1 x43  LiquidationFeeCharged (liquidationEngineEventsAbi)  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0x83fa34f7 x24  NOT DECODABLE WITH ANY SDK ABI  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0x0e0d416a x43  LiquidationKeeperRewardPaid (liquidationEngineEventsAbi)  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0x1d68b7d3 x47  NOT DECODABLE WITH ANY SDK ABI  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0x1624f8f3 x59  AccountLiquidated (liquidationEngineEventsAbi)  e.g. 0x01e16a12552b1c110c6bda8454c7760188eb40fd5a3ff119d908a7c9579648f5
  0xabddd757 x12  NOT DECODABLE WITH ANY SDK ABI  e.g. 0x317e543230ad78d12adcaf82903381820f6d12dc2904c37b869c68dbc876850c
liquidationEngineEventsAbi names: AccountLiquidated, PositionLiquidated, PositionSkippedBelowMinQuantity, PositionTakenOver, LiquidationFeeCharged, LiquidationKeeperRewardPaid, LiquidationThrottled, ResidualBadDebt, ResidualBackedByOpenPnl, CoverageDeclinedByEquityCap, AdlCapacityShortfall, AdlPriceCapacityExhausted, AdlSessionDiscarded
indexer LiquidationEvent kind TakeoverBandClamped, newest: [{"account":"0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8","pool":"0x7058579f3248559963f79adb937c6de9f953e060","price":"1343727274446500000","marketBound":"1377320456307662500","clampedBound":"1376882806425723778","blockNumber":"28563558","txHash":"0x3d6e0f856bb6c27d646f6fc7bbf55cfb1595cf4b08475b5de379c31b6148c676"}, ...]
indexer PerpFeeRecord kind LiquidationFeeSkipped, newest: [{"account":"0x750a37b79570eb7e89e55fe978da0625173a6a51","pool":"0x7058579f3248559963f79adb937c6de9f953e060","amount":"0","fillNotional":"3120705570000000000000","skipReason":7,"requestedAmount":"0","txHash":"0x48b223de1cafc24645eb5d40ca93d03bb1838959f089be9bb1659df934f5cee6"}, ...]
  TakeoverBandClamped tx 0x3d6e0f856bb6c27d646f6fc7bbf55cfb1595cf4b08475b5de379c31b6148c676: LE log topic0 0x83fa34f737ba91bba5f20c6d7d882303fbb32367c0ecdc6969758826c490d3be topics 0x…327861124ea6d7e4ee3c61d18b7b978e53b16dc8 0x…7058579f3248559963f79adb937c6de9f953e060 data 0x…12a5e0d6346330a0 …131d39a85c18dea4 …131bab9e0e592382 -> decodeEventLog(liquidationEngineEventsAbi) throws AbiEventSignatureNotFoundError
  LiquidationFeeSkipped tx 0x48b223de1cafc24645eb5d40ca93d03bb1838959f089be9bb1659df934f5cee6: LE log topic0 0xabddd75762e0d6f38592eb52d5227a748603b3ae167f9f546fd3712d63ce991d topics 0x…750a37b79570eb7e89e55fe978da0625173a6a51 0x…7058579f3248559963f79adb937c6de9f953e060 0x…07 data 0x…a92c7d5db550ec2000 …00 -> decodeEventLog(liquidationEngineEventsAbi) throws AbiEventSignatureNotFoundError
LIQUIDATION_KIND has TakeoverBandClamped: false; isLiquidationKind("TakeoverBandClamped") = false
listLiquidations({kind:"TakeoverBandClamped"}) -> 3 rows
listLiquidations({account:0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8}) kinds: AccountLiquidated, KeeperReward, PositionLiquidated, TakeoverBandClamped
listPerpFees({kind:"LiquidationFeeSkipped"}) row keys: id, account, pool, amount, isRebate, kind, insurancePortion, tier, fillNotional, builder, timestamp, txHash; has skipReason: false
```
The three data words of `0x83fa34f7` match the indexed row exactly: `0x12a5e0d6346330a0` = 1343727274446500000 (`price`), `0x131d39a85c18dea4` = 1377320456307662500 (`marketBound`), `0x131bab9e0e592382` = 1376882806425723778 (`clampedBound`). The `0xabddd757` data word `0xa92c7d5db550ec2000` = 3120705570000000000000 (`fillNotional`), and topic 3 = 7 (`skipReason`).

Run 2 (head 28569957): the same seven topic0s with the same counts (55/43/24/43/47/59/12), the same three undecodable, and the same SDK results.

Note: `listLiquidations({ kind: "TakeoverBandClamped" })` works at runtime (it needs an `as any` cast in TypeScript), so the indexer path is reachable. The gap is the published ABI, the kind vocabularies, and the fee row's missing reason.

## Suggested fix
Add the two fragments to `liquidationEngineEventsAbi`, generated from `indexer/abis/LiquidationEngine.json` like the rest. Add `TakeoverBandClamped` to `LIQUIDATION_KIND` (and document `price`/`marketBound`/`clampedBound` on `LiquidationEvent`). Document `LiquidationFeeSkipped` on `PerpFeeRecord.kind`, with its reason enum, and select `skipReason` / `requestedAmount` in `listPerpFees`. If they are left out on purpose, add them to the exclusion list in the const's TSDoc.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
