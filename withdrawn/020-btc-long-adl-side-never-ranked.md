# BTC longs have 5,157 ADL holders against a 500-holder scan cap, so ADL would skip the ranker on that side, and the docs' ADL queue and ADL bars do not apply to it

Severity: normal
Area: docs

The trader docs promise an ADL order and an ADL rank for every position:

> ADL reduces profitable positions on the opposite side of the same market, those with the most profit relative to their account's equity first. [...] The **ADL** column in your positions table shows where each position stands in that queue as five bars.

The SDK documents an exception that the trader page never mentions. `LiquidationEngine.getMaxAdlScanPerCall()` is "the most holders the engine ranks in one call. A side with MORE holders is walked in storage order and the ranker is never called" (`src/readsAbi.ts:560-561`; also `docs/PERPS.md:380-382` and the `storageOrder` regime in `src/perp/adl.ts:180-182`).

On the perps testnet that exception covers the biggest side of the biggest market:

- `getMaxAdlScanPerCall()` = **500**.
- The BTC long holder list in the MarginBank (`getSideHolderStatesPaginated(BTC, true, …).listLength`) has **5,157** entries. Every one holds a position. About 3,800 of them are ADL candidates (in profit, priceable, positive equity).
- It is the only one of the 42 sides over the cap. The next largest is ETH long with about 330.
- The SDK's own `perpAdlQueue.getSnapshot` returns `regime: "storageOrder"` for BTC long, with no holders and no ranks. So there is nothing an app can draw the five ADL bars from on that side.

In storage order, the first candidate the walk reaches is a 0.89x account at slot 38 with pnl/equity 0.007. The most leveraged BTC long (17.8x) is at slot 4,002, and the highest pnl/equity candidate is at slot 669. 14 of the 20 highest pnl/equity BTC longs sit past slot 500, outside the first call's scan. So whatever order the docs describe, an ADL against BTC shorts would hit BTC longs by position in the holder list (roughly, how early they opened), not by profit or leverage.

Why it matters: BTC is the market where most traders hold longs. The documented protection ("most profit relative to equity first") and the ADL bars do not hold there, and nothing in the trader docs says so. A low-leverage, barely profitable long that happens to sit early in the list is deleveraged before a 17x long. The SDK knows about this case (`storageOrder`), but the trader docs do not.

This is a separate issue from 019 (what the ranker ranks by). Here the ranker is not called at all.

We did not see an ADL happen. There are no ADL rows in the indexer's `LiquidationEvent` table. The storage-order behaviour comes from the SDK's description of the engine. The holder count and the cap are read from the chain.

## Steps to reproduce
1. In a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx`, run `npx tsx 020-repro.mts`. It is read-only: view calls only. The script:
   - reads `getMaxAdlScanPerCall()` and `getAdlRanker()` from the LiquidationEngine;
   - reads the holder-list length of all 42 perp sides from `MarginBank.getSideHolderStatesPaginated(pool, isLong, 0, 0)`;
   - pages through the whole BTC long list at one block, classifies every holder the way `perpAdlQueue` does (flat, not in profit, no equity, unpriceable, candidate), and prints where the first, most-leveraged and highest-pnl/equity candidates sit in storage order;
   - calls the SDK's `perpAdlQueue.getSnapshot({ pool: BTC, isLong: true })`.
2. Compare with the "Liquidations" paragraph on `/docs/trading/perps-testnet/margin-and-liquidations`.

## Expected
Either every side is ranked as the docs describe, or the docs say that a side with more than `getMaxAdlScanPerCall()` holders is deleveraged in holder-list order and has no ADL rank (and the app shows that instead of the five bars).

## Actual
Run 1 (2026-10-20, head 28,608,486):
```
LiquidationEngine.getMaxAdlScanPerCall() = 500; ranker 0x3d7466A217e375635386d3c5da30a82959DdB789
sides with more holders than the scan cap (42 sides checked): BTC long: 5157 holders
BTC long holder list: 5157 entries; flat 0, not in profit 1368, no equity 0, unpriceable 0, ADL candidates 3789 (200 of them in the first 500 storage slots)
  first candidate in storage order: slot 38 0x947a1cA79D6f7080978DCA92454d2101e129f4D9 pnl/equity 0.0066 leverage 0.89x
  highest leverage candidate:       slot 4002 0xA7AB406d7F0345dAA0d1E7441a1154AAfb7406f0 pnl/equity 0.0443 leverage 17.82x
  highest pnl/equity candidate:     slot 669 0xBA2D7748400357a2b159A4e5Eda8f3B5fBf6E8e1 pnl/equity 0.2375 leverage 12.48x
  top-20 candidates by pnl/equity that sit past slot 500: 14/20
SDK perpAdlQueue.getSnapshot(BTC long): regime "storageOrder", holderCount 5159, scanCap 500, holders listed: none
```
Run 2 (head 28,611,519):
```
sides with more holders than the scan cap (42 sides checked): BTC long: 5158 holders
BTC long holder list: 5158 entries; flat 0, not in profit 1321, no equity 0, unpriceable 0, ADL candidates 3837 (202 of them in the first 500 storage slots)
  first candidate in storage order: slot 38 0x947a1cA79D6f7080978DCA92454d2101e129f4D9 pnl/equity 0.0067 leverage 0.89x
  highest leverage candidate:       slot 4002 0xA7AB406d7F0345dAA0d1E7441a1154AAfb7406f0 pnl/equity 0.0470 leverage 17.78x
  highest pnl/equity candidate:     slot 669 0xBA2D7748400357a2b159A4e5Eda8f3B5fBf6E8e1 pnl/equity 0.2391 leverage 12.46x
  top-20 candidates by pnl/equity that sit past slot 500: 14/20
SDK perpAdlQueue.getSnapshot(BTC long): regime "storageOrder", holderCount 5158, scanCap 500, holders listed: none
```

## Suggested fix
Docs: add the scan-cap exception to the Liquidations section, and say what the ADL column shows on a side that is over the cap. Protocol: raise `maxAdlScanPerCall` above the largest side (or rank in pages) so the documented order also holds for BTC longs, or keep the holder list free of dust and paper-sized positions so the busiest side stays under the cap.

## Evidence
- Repro script: `020-repro.mts` in this folder (read-only: `eth_call`, `eth_getLogs` and indexer queries; it signs nothing). Run with `npx tsx 020-repro.mts` from a project with `@somnia-chain/markets-sdk@0.32.1` installed. The output under **Actual** comes from two separate runs.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, BTC pool 0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0, read-only (no wallet, no transactions).
