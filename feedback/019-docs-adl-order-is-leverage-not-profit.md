# Docs say ADL closes "the most profit relative to equity first", but the armed ADL ranker orders by leverage and ignores profit

Severity: normal
Area: docs

The trader docs (Perps on Testnet › Margin & Liquidations › Liquidations) say:

> ADL reduces profitable positions on the opposite side of the same market, those with the most profit relative to their account's equity first.

and the next paragraph says the positions table's **ADL** column shows "where each position stands in that queue".

The ranker that the LiquidationEngine uses in stage 6 (`LiquidationEngine.getAdlRanker()` = `0x3d7466A217e375635386d3c5da30a82959DdB789`) does not rank by profit. It ranks by leverage: position notional over account equity. Profit only decides who is a candidate (in profit or not). How much profit a position has does not change its place in the queue.

- Asked directly through `AdlRanker.rank()` (an `eth_call`), with two profitable longs on ETH at the current mark: A is +100% on the position at 1x (pnl/equity 0.50), B is +0.1% at 15x (pnl/equity 0.015). The ranker puts **B first**. The docs' rule puts A first.
- On every live ranked side we checked, the ranker's order matches notional/equity almost exactly (Spearman 0.998 to 1.000), while its match with pnl/equity is loose (0.38 to 0.94). On the ETH long side, #1 has pnl/equity about 0.04 at 18x, and a position barely in profit (pnl/equity 0.003 to 0.013, 15.8x to 17.5x) sits at #2 to #4. The account with the highest pnl/equity on that side is #12.

The SDK's own description agrees with the chain, not with the trader page. `PerpAdlHolder.positionLeverageBps` says "The ranker scores a leverage factor close to this one" (`src/perp/adl.ts:108-112`), and SDK `docs/PERPS.md:366` says only "in the order that its ranker contract decides". So the trader-facing page is the one that is wrong.

Why it matters: a trader reads the docs to decide how to avoid being auto-deleveraged. Under the documented rule, a barely profitable position is near the back of the queue. In fact a barely profitable position at high leverage is at the front, and a very profitable low-leverage position is at the back. A bot or UI that re-derives the ADL bars from the documented rule shows the wrong positions as at risk.

## Steps to reproduce
1. In a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx`, run `npx tsx 019-repro.mts`. It is read-only: view calls and `eth_call` only. Nothing is signed or sent. The script:
   - reads the armed ranker from `LiquidationEngine.getAdlRanker()`;
   - calls `AdlRanker.rank()` on two synthetic profitable ETH longs (A: high profit at 1x, B: tiny profit at 15x) at the current ETH mark;
   - for six live ranked sides, takes the candidates and ranks from the SDK's `perpAdlQueue.getSnapshot` (which calls the same ranker), marks them at the same block, and prints the Spearman rank correlation of the ranker's order against pnl/equity and against notional/equity.
2. Compare with the "Liquidations" paragraph on `/docs/trading/perps-testnet/margin-and-liquidations`.

## Expected
Either the ranker orders by profit relative to equity, as the docs say, or the docs describe the real rule: candidates are profitable positions, ordered by leverage (notional / equity), highest first.

## Actual
Run 1 (2026-10-20, head 28,611,085):
```
armed AdlRanker 0x3d7466A217e375635386d3c5da30a82959DdB789
  A: +100% on the position, 1x leverage: pnl 1218.35 USDso, equity 2436.70, pnl/equity 0.5000, notional/equity 1.00x
  B: +0.1% on the position, 15x leverage: pnl 2.44 USDso, equity 162.45, pnl/equity 0.0150, notional/equity 15.00x
AdlRanker.rank([A, B]) -> [1,0]  => closes first: B: +0.1% on the position, 15x leverage
ETH long  block 28611101: 172 candidates; Spearman(order, pnl/equity) 0.900  Spearman(order, notional/equity) 1.000
    #1 0x051655EBceC156160b69E372e3437677973ccEA2 pnl/equity 0.0507  leverage 18.03x
    #2 0x7b9f03095c48f818fb7A655757099Cd83589AFE2 pnl/equity 0.0029  leverage 17.51x
    #3 0x4882616cAd106023da02F8735D63bc5A47d3E3Ef pnl/equity 0.1863  leverage 16.15x
    #4 0xca165304E15E46a8BAC4eF35a1Aba6820a69ed56 pnl/equity 0.0128  leverage 15.81x
    highest pnl/equity on this side: #12 0x82F3fd9Bb64Ad9641C7683BCb3414E32Ab984099 pnl/equity 0.2954 leverage 13.87x
ETH short: 102 candidates; Spearman(order, pnl/equity) 0.494  (order, notional/equity) 0.999
SOL long : 132 candidates; 0.888 / 1.000
SOL short: 114 candidates; 0.487 / 0.999
XRP short: 119 candidates; 0.838 / 1.000
BTC short: 165 candidates; 0.803 / 0.998
```
Run 2 (head 28,611,262): same ranker answer `[1,0]` (B first). ETH long 170 candidates, 0.920 / 1.000, #12 again has the highest pnl/equity. ETH short 0.435 / 0.999, SOL long 0.870 / 1.000, SOL short 0.472 / 0.999, XRP short 0.791 / 1.000, BTC short 0.783 / 0.998.

The correlation with pnl/equity is only as high as it is because, at one mark, leverage and pnl/equity move together for positions with similar entries. Where entries are spread out (ETH and SOL shorts), it drops below 0.5, while the leverage correlation stays at 0.998 to 1.000. The synthetic pair takes entry prices out of the picture.

## Suggested fix
Change the trader docs to the real rule, for example: "ADL reduces profitable positions on the opposite side of the same market, the most leveraged first (position value relative to the account's equity). Being in profit makes a position eligible; how much profit does not move it up the queue." If the profit-weighted order is the intended design, change the ranker instead (for example score `pnl% × leverage`, as most venues do).

## Related: BTC long side exceeds the ADL scan cap
(Merged from our former item 020; same docs paragraph.) The "most ... first" order and the ADL bars do not apply at all to a side with more holders than `LiquidationEngine.getMaxAdlScanPerCall()`. The SDK says such a side "is walked in storage order and the ranker is never called" (`src/readsAbi.ts:560-561`, `docs/PERPS.md:380-382`, the `storageOrder` regime in `src/perp/adl.ts:180-182`). The trader page does not mention it.

- `getMaxAdlScanPerCall()` = **500**. The BTC long holder list (`MarginBank.getSideHolderStatesPaginated(BTC, true, …).listLength`) has **5,157** entries (run of 2026-10-20, head 28,608,486). It is the only one of the 42 sides over the cap.
- `perpAdlQueue.getSnapshot({ pool: BTC, isLong: true })` returns `regime: "storageOrder"` with no holders and no ranks, so an app has nothing to draw the five ADL bars from on that side.
- In storage order the first candidate was a 0.89x account at slot 38 (pnl/equity 0.007), the most leveraged long (17.8x) was at slot 4,002, and 14 of the 20 highest pnl/equity longs sat past slot 500.
- We did not see an ADL happen (no ADL rows in the indexer). The storage-order behaviour is the SDK's description of the engine; the holder count and the cap are read from the chain.

Repro: `npx tsx 019-repro-b.mts` (read-only, view calls only; byte-identical to the former `020-repro.mts`). Re-run 2026-10-20, head 28,794,534:
```
LiquidationEngine.getMaxAdlScanPerCall() = 500; ranker 0x3d7466A217e375635386d3c5da30a82959DdB789
sides with more holders than the scan cap (42 sides checked): BTC long: 5239 holders
BTC long holder list: 5239 entries; flat 0, not in profit 661, no equity 0, unpriceable 0, ADL candidates 4578 (244 of them in the first 500 storage slots)
  first candidate in storage order: slot 4 0x5c693d3D7DaCFd71F6F70A0cB6010A773e004d68 pnl/equity 0.0016 leverage 0.33x
  highest leverage candidate:       slot 563 0xf5c57d114c12ABA9bCe3dBcDC3aa0150B4F14fcD pnl/equity 0.0231 leverage 17.04x
  highest pnl/equity candidate:     slot 669 0xBA2D7748400357a2b159A4e5Eda8f3B5fBf6E8e1 pnl/equity 0.2950 leverage 11.75x
  top-20 candidates by pnl/equity that sit past slot 500: 14/20
SDK perpAdlQueue.getSnapshot(BTC long): regime "storageOrder", holderCount 5239, scanCap 500, holders listed: none
```
Suggested docs addition: "A side with more than `getMaxAdlScanPerCall()` holders is deleveraged in holder-list order and has no ADL rank", and show that in the ADL column instead of the five bars. Protocol alternative: raise `maxAdlScanPerCall` above the largest side, or rank in pages.

## Evidence
- Repro script: `019-repro.mts` in this folder (read-only: `eth_call`, `eth_getLogs` and indexer queries; it signs nothing). Run with `npx tsx 019-repro.mts` from a project with `@somnia-chain/markets-sdk@0.32.1` installed. The output under **Actual** comes from two separate runs.
- Blocks: 28611101
- Related section: `019-repro-b.mts` in this folder (same run instructions). Re-run of `019-repro.mts` on 2026-10-20 at head 28,794,534 gave the same ranker answer `[1,0]` (B first) and leverage correlations of 0.998 to 1.000 on all six sides.

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, indexer https://hideki-dev.smk.somnia.host/v1/graphql, LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, AdlRanker 0x3d7466A217e375635386d3c5da30a82959DdB789, read-only (no wallet, no transactions).
