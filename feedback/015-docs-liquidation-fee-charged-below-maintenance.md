# Docs say the liquidation fee comes "only from the surplus" and an account that ends just above maintenance pays nothing, but the full 1% is charged on closes that leave the account below maintenance

Severity: normal
Area: docs

The trader page "Margin & Liquidations" (`/docs/trading/perps-testnet/margin-and-liquidations`, section Liquidations) says:

> A liquidation on the book charges a fee of **up to 1%** of the notional it closes, taken only from the surplus the close creates: an account that comes back just above maintenance margin pays nothing. When the close leaves no position open, the fee can come out of the remaining equity instead, still capped at 1%.

A reader takes "surplus" to mean equity above maintenance margin after the close, and the example confirms that reading. If an account that ends *just above* maintenance pays nothing, then an account that ends *below* maintenance, with its position still open, should pay nothing too.

On the perps testnet the LiquidationEngine does the opposite. In the latest 400 `AccountLiquidated` events whose own `marginStatusAfter` is `PartialLiquidation` (2) or `CloseOut` (3), 29 also carry a `LiquidationFeeCharged` for the same account in the same transaction, while the position stays open. These are 101.58 USDso of fees in total. Almost all are exactly 1.0000% of `fillNotional`. One XRP account was charged 15 times in a row (15.36 USDso) while it stayed in `PartialLiquidation` the whole time. Each fee pushed it further below maintenance, and the next round followed.

What the chain seems to do instead: the fee is capped by how much the close improved `equity − mmReq`. It is not limited to the equity above maintenance. In every case printed, `equity − mmReq` without the fee is better than before the close by more than the fee. For example, block 28563558: −5.61 before, −3.37 after the close without the fee, −4.52 with the 1.15 USDso fee. So "surplus the close creates" means "improvement in the shortfall", and an account can pay the full 1% and still end below maintenance. The docs' example describes a different rule.

Why it matters: this is the trader page that explains liquidation costs. It tells traders a liquidation that does not restore them costs nothing extra. Traders and bots that estimate liquidation outcomes from the docs (for example, how much equity is left after a partial close, or whether to top up margin while in `PartialLiquidation`) under-estimate the loss. The repeated-round case shows the effect compounding: each fee keeps the account under maintenance, which brings the next round and the next fee.

This is distinct from 011 (where the fee goes after it is charged). This item is about *when* it is charged.

## Steps to reproduce
1. Run `npx tsx 015-repro.mts [rows] [print]` (read-only; `@somnia-chain/markets-sdk@0.32.1`, `viem`, `tsx`). It:
   - reads the latest indexed `LiquidationEvent` rows of kind `AccountLiquidated` with `marginStatusAfter >= 2`;
   - decodes each transaction receipt on chain with the SDK's `liquidationEngineEventsAbi` + `marginBankEventsAbi` (the indexer is only used to find the transactions). For the liquidated account it takes `AccountLiquidated` (status before → after, from the event itself), every `LiquidationFeeCharged` (amount, `fillNotional`), and the last `PositionUpdated.newSize`;
   - for the printed cases, reads `MarginBank.getAccountHealth(account)` at `block − 1` and at `block`, and prints `equity − mmReq` with and without the fee. End-of-block state can include later transactions in the same block; the status transition comes from the event and does not depend on it.
2. Compare with the Liquidations section of Margin & Liquidations (also served at `https://app.testnet.dreamdex.io/llms-full.txt`).

## Expected
Per the docs: no fee, or a fee capped by the equity above maintenance after the close, when the close leaves the account below maintenance margin with a position still open. Alternatively, the docs describe the real rule (fee ≤ the improvement the close makes in `equity − mmReq`, up to 1% of notional), and say the account can still end below maintenance and be liquidated again.

## Actual
Run 1 (2026-10-20, head 28566338):
```
head 28566338; AccountLiquidated rows ending below maintenance (status after >= 2): 400
block 28563558 tx 0x3d6e0f856bb6c27d646f6fc7bbf55cfb1595cf4b08475b5de379c31b6148c676
  account 0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8 pool 0x7058579F3248559963f79AdB937c6De9f953E060: AccountLiquidated status PartialLiquidation -> PartialLiquidation, positionsProcessed 1, position left -9251200000
  LiquidationFeeCharged 1.150481 USDso on fillNotional 115.05 (1.0000%)
  block-1: equity 308.038356 mmReq 313.649461 (shortfall 5.611105)
block 28563530 tx 0x088abef6f44fd6dbc0d62dd67062d549bfc02dab47e585cb4a802aa5498d0da7
  account 0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8 ...: PartialLiquidation -> PartialLiquidation, position left -9336700000
  LiquidationFeeCharged 0.999697 USDso on fillNotional 99.97 (1.0000%)
...
block 28563241 tx 0xecd64b50aa7a71f3e71c0e08c0d0658b8ef787ebf258219c51e22dd19334f9d5
  account 0x6d06d484ca21335b761c03da99dcbc510fa5cacc ...: PartialLiquidation -> PartialLiquidation, positionsProcessed 1, position left -26357800000
  LiquidationFeeCharged 1.149046 USDso on fillNotional 114.90 (1.0000%)
  block-1: equity 883.110738 mmReq 887.119162 (shortfall 4.008424)

fee-charging liquidations that left the account below maintenance margin: 29 of 400; fees charged 101.580922 USDso
  0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8: 15 such fees, 15.361388 USDso
  0x6d06d484ca21335b761c03da99dcbc510fa5cacc: 7 such fees, 7.243815 USDso
  0xf88c9d3eb61829f92d74a260ab2f172551e36fca: 3 such fees, 0.602959 USDso
  0xb7169bb3983b5ee1e27396c7b1367e2a74da2691: 1 such fees, 4.311289 USDso
  0x406e0fb4b97ea3743ca9e64b0fbe84ff12bbb3c6: 1 such fees, 41.324011 USDso
```
Run 2 (head 28567314, with the after-state added):
```
block 28563558 tx 0x3d6e0f856bb6c27d646f6fc7bbf55cfb1595cf4b08475b5de379c31b6148c676
  account 0x327861124ea6d7e4ee3c61d18b7b978e53b16dc8 pool 0x7058579F3248559963f79AdB937c6De9f953E060: AccountLiquidated status PartialLiquidation -> PartialLiquidation, positionsProcessed 1, position left -9251200000
  LiquidationFeeCharged 1.150481 USDso on fillNotional 115.05 (1.0000%)
  equity - mmReq: block-1 -5.611105, end of block -4.522911 (without the fee -3.372430)
block 28563530 tx 0x088abef6f44fd6dbc0d62dd67062d549bfc02dab47e585cb4a802aa5498d0da7
  ... PartialLiquidation -> PartialLiquidation, position left -9336700000
  LiquidationFeeCharged 0.999697 USDso on fillNotional 99.97 (1.0000%)
  equity - mmReq: block-1 -11.691426, end of block -9.931282 (without the fee -8.931585)
block 28563527 tx 0x152f07c09a9cb3b554f4655a49cd5fe2bfce2442c504372588bb311caae72efb
  ... PartialLiquidation -> PartialLiquidation, position left -9410900000
  LiquidationFeeCharged 0.150830 USDso on fillNotional 15.08 (1.0000%)
  equity - mmReq: block-1 -11.889319, end of block -11.691426 (without the fee -11.540595)
block 28563523 tx 0xad1a335a98f8549552ab31add729e3c52e3be545b6d15935919de58ced8c8b79
  ... PartialLiquidation -> PartialLiquidation, position left -9422100000
  LiquidationFeeCharged 1.003743 USDso on fillNotional 100.37 (1.0000%)
  equity - mmReq: block-1 -14.846965, end of block -13.426267 (without the fee -12.422524)

fee-charging liquidations that left the account below maintenance margin: 29 of 400; fees charged 101.580922 USDso
```
Older cases from the same query reach `CloseOut` → `CloseOut` (status 3 → 3) with a fee. For example, block 22615636, tx `0xe1a26f53a93b88eb150cf7e6514c85c02a6eff0976946ed5938ccdaf752c4f90`: a 41.32 USDso fee, with equity going from 61.90 to 17.86 against mmReq 125.40 afterwards, and the position still open.

Across the latest 1,000 `AccountLiquidated` rows, the status transitions joined with fee records are: `2→2` with fee 25, `3→3` with fee 4, `2→2` without fee 219, `2→1` with fee 105, `2→1` with `LiquidationFeeSkipped` 45, `2→0` with fee 559.

## Suggested fix
Describe the implemented rule on the trader page, for example: "The fee is up to 1% of the notional closed, and never more than the margin the close frees up. A close can therefore charge a fee and still leave you below maintenance margin, in which case the next liquidation round follows." If the documented rule is the intended one, make the engine skip the fee whenever `marginStatusAfter` is still below maintenance with a position open. It already has a skip path (`LiquidationFeeSkipped`).

## Evidence
- Repro script: `015-repro.mts` in this folder (read-only: `eth_call`, `eth_getLogs` and indexer queries; it signs nothing). Run with `npx tsx 015-repro.mts` from a project with `@somnia-chain/markets-sdk@0.32.1` installed. The output under **Actual** comes from two separate runs.
- Transactions: `0x3d6e0f856bb6c27d646f6fc7bbf55cfb1595cf4b08475b5de379c31b6148c676`, `0x088abef6f44fd6dbc0d62dd67062d549bfc02dab47e585cb4a802aa5498d0da7`, `0xecd64b50aa7a71f3e71c0e08c0d0658b8ef787ebf258219c51e22dd19334f9d5`, `0x152f07c09a9cb3b554f4655a49cd5fe2bfce2442c504372588bb311caae72efb`, `0xad1a335a98f8549552ab31add729e3c52e3be545b6d15935919de58ced8c8b79`, `0xe1a26f53a93b88eb150cf7e6514c85c02a6eff0976946ed5938ccdaf752c4f90`
- Blocks: 28563558, 28563530, 28563241, 28563527, 28563523, 22615636,

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, indexer https://hideki-dev.smk.somnia.host/v1/graphql, docs checked 2026-10-20, read-only.
