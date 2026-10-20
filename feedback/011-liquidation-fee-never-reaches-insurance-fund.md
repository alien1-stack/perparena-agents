# Liquidation fees are taken from traders and logged as going to an Insurance Fund tier, but no tier balance ever grows (about 77,000 USDso in 690 fees is not in the fund)

Severity: major
Area: contracts

When the LiquidationEngine closes a position on the book, it charges a fee of up to 1% of the notional closed. It emits `LiquidationFeeCharged(account, perpPool, tier, fillNotional, amount)`, and the MarginBank debits the amount from the liquidated account. The SDK says where that money goes:

- `PerpFeeRecord.kind` `LiquidationFee`: "stage-3 health-preserving liquidation fee, routed WHOLLY to an Insurance Fund tier (see `tier` / `fillNotional`)" (`src/perp/history.ts:572`).
- `insurancePortion` "equals `amount`, because that fee goes wholly to a tier. Written on both so `SUM(insurancePortion)` is the fund's fee inflow" (`src/perp/history.ts:584-586`).
- The insurance-fund ledger lists `TierCredited`, "the insurance share of a fee, booked by MarginBank", as an inflow (`src/perp/system.ts:298`).

On chain the money never reaches a tier. Every InsuranceFund tier balance still equals the sum of the admin `TierFunded` top-ups made at blocks 6.9M. Meanwhile 690+ liquidation fees, about 77,000 USDso, have been charged to traders against tiers 1, 2 and 3. Inside a fee transaction:

- the liquidated account's MarginBank balance drops by exactly `realizedPnl − funding − fee`;
- `getTierBalance(tier)` is unchanged;
- the InsuranceFund's own MarginBank balance is unchanged;
- the InsuranceFund emits no event;
- no USDso `Transfer` carries the fee (the only transfers are the 0.07 USDso keeper reward);
- the counterparty maker, the keeper and the fee recipient are not credited (checked for tx `0x51307e…`).

The fee leaves the trader and goes nowhere that can be observed. It is either stranded as untracked surplus in the MarginBank or lost. Either way the backstop the trader docs describe ("the Insurance Fund covers any remaining shortfall") does not grow from the fees that are meant to fund it, and the indexer's `insurancePortion`/`tier` fields describe a credit that did not happen.

Insurance coverage is enabled on all 21 pools (`MarginBank.isInsuranceFundCoverageEnabled(pool) == true`), every pool maps to tier 1, 2 or 3 (`InsuranceFund.getTierForPool`), and `getPerpSystemConfig().fullyWired == true`. So this is not a half-configured stack.

## Steps to reproduce
1. Run `npx tsx 011-repro.mts [n]` from a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx` (read-only, no key). It:
   - sums every indexed `PerpFeeRecord` of kind `LiquidationFee` per tier, and every `PerpInsuranceFundEvent` of kind `TierFunded` per tier;
   - reads `InsuranceFund.getTierBalance(t)` and `getTotalTierBalances()` at head, plus the fund's own MarginBank balance;
   - for the latest `n` fee transactions, decodes the receipt with the SDK's `marginBankEventsAbi` + `liquidationEngineEventsAbi`, then reads the liquidated account's `unlockedCollateralBalance`, the tier balance and the fund's bank balance at `block − 1` and `block`.

## Expected
Each `LiquidationFeeCharged(…, tier, …, amount)` raises `InsuranceFund.getTierBalance(tier)` by `amount`, or the fund's MarginBank balance, with a `TierCredited` event. Then `tier balance = top-ups + Σ insurancePortion − Σ coverage draws`. If the fee is meant to go somewhere else, the event, the indexer row and the SDK docs say so.

## Actual
Run 1 (2026-10-20, head 28543963):
```
LiquidationFee rows: 687; InsuranceFund event kinds ever indexed: TierFunded
tier 1: admin top-ups 340000.000000 + liquidation fees "to insurance" 42601.051735 = expected 382601.051735; chain getTierBalance 340000.000000
tier 2: admin top-ups 120000.000000 + liquidation fees "to insurance" 34016.449241 = expected 154016.449241; chain getTierBalance 120000.000000
tier 3: admin top-ups 65000.000000 + liquidation fees "to insurance" 31.930859 = expected 65031.930859; chain getTierBalance 65000.000000
getTotalTierBalances 525000.000000; InsuranceFund's own MarginBank balance 525000.000000
tx 0x51307ef1956b6343406e84ed71d2ed8e1e0b0fd29a1f464f5e868794f86108a5 block 28538326
  liquidated 0x3c6306429f57ca3d189b90f8e142ab72c10fff3d: LiquidationFeeCharged 176.723698 to tier 1; realizedPnl -596.749400; funding paid -2.894043
  account unlocked collateral 1000.000000 -> 229.420945 (delta -770.579055; pnl - funding - fee = -770.579055)
  InsuranceFund tier 1 balance 340000.000000 -> 340000.000000 (delta 0.000000); fund's MarginBank balance delta 0.000000; logs emitted by InsuranceFund in this tx: 0
tx 0x9c394a0c4e84d92b0dfb338fe70b23eb943cdfcd04549a7ba49e09ce0b9a5f1f block 28538240
  liquidated 0x9d141372f244bca24d36aa2dae19134fe2fbe345: LiquidationFeeCharged 248.394472 to tier 2; realizedPnl -751.841781; funding paid -1.075579
  account unlocked collateral 2370.460572 -> 1371.299898 (delta -999.160674; pnl - funding - fee = -999.160674)
  InsuranceFund tier 2 balance 120000.000000 -> 120000.000000 (delta 0.000000); fund's MarginBank balance delta 0.000000; logs emitted by InsuranceFund in this tx: 0
tx 0xbf77cdfea84ac0dcf4b6b0d541f8673be58ec9f4013949aee000f59187cfa4ba block 28538196
  liquidated 0x92b9b27565b7b61f1065dc7628937f22161c21f0: LiquidationFeeCharged 279.100251 to tier 1; realizedPnl -910.446285; funding paid -6.908913
  account unlocked collateral 2000.000000 -> 817.362378 (delta -1182.637622; pnl - funding - fee = -1182.637622)
  InsuranceFund tier 1 balance 340000.000000 -> 340000.000000 (delta 0.000000); fund's MarginBank balance delta 0.000000; logs emitted by InsuranceFund in this tx: 0
```
Run 2 (head 28552075, about 25 minutes later, 5 new fees):
```
LiquidationFee rows: 692; InsuranceFund event kinds ever indexed: TierFunded
tier 1: admin top-ups 340000.000000 + liquidation fees "to insurance" 42820.698532 = expected 382820.698532; chain getTierBalance 340000.000000
tier 2: admin top-ups 120000.000000 + liquidation fees "to insurance" 34471.120591 = expected 154471.120591; chain getTierBalance 120000.000000
tier 3: admin top-ups 65000.000000 + liquidation fees "to insurance" 31.930859 = expected 65031.930859; chain getTierBalance 65000.000000
getTotalTierBalances 525000.000000; InsuranceFund's own MarginBank balance 525000.000000
tx 0x5bf1aa325799fb07a0c831793bb57b9ed462779587ace26ba045059fdee1ed8f block 28551303
  liquidated 0x3c85a44b59aef479f4a5758a524137857f7f21fc: LiquidationFeeCharged 225.584889 to tier 2; realizedPnl -659.040160; funding paid -5.752813
  account unlocked collateral 1149.947947 -> 271.075711 (delta -878.872235; pnl - funding - fee = -878.872235)
  InsuranceFund tier 2 balance 120000.000000 -> 120000.000000 (delta 0.000000); fund's MarginBank balance delta 0.000000; logs emitted by InsuranceFund in this tx: 0
tx 0xc0333a309b37641979b0c7d2686f34d146c7c8f363b819cc4e9e9a7d81717274 block 28550525
  liquidated 0xe0b0532c3dd439cd1fd9d0728e9fe2cde06f90ae: LiquidationFeeCharged 86.942277 to tier 2; realizedPnl -517.694480; funding paid -0.062566
  account unlocked collateral 991.636424 -> 387.062233 (delta -604.574192; pnl - funding - fee = -604.574192)
  InsuranceFund tier 2 balance 120000.000000 -> 120000.000000 (delta 0.000000); fund's MarginBank balance delta 0.000000; logs emitted by InsuranceFund in this tx: 0
```
Other checks, same session: the USDso `Transfer` logs in `0x51307e…` and `0x9c394a…` are only the 0.07 USDso keeper reward (MarginBank → keeper → keeper owner). `balanceOf(InsuranceFund) = 0`. In block 28538326, the maker `0xA8ef09…` (unlocked+locked), the keeper and the fee recipient are unchanged. The first indexed `LiquidationFee` is from timestamp 1790685330 (about 21 days ago). The tier balances have not moved since the top-ups at blocks 6917558–6924083.

## Impact
- **Accounting:** traders are charged a fee whose only stated purpose is to fund the insurance tier. The tier does not receive it, so about 77k USDso (and growing) is unaccounted for. If it stays in the MarginBank as surplus that no account owns, `Σ account balances` and the bank's token balance drift apart by that amount, and nothing can withdraw or reconcile it.
- **Solvency backstop:** bad-debt coverage reads `getTierBalance`, so the fund is ~20% smaller than the fee flow implies (tier 2: 120k vs 154k), and it will never grow organically.
- **Indexer/SDK data is wrong:** `listPerpFees({kind:"LiquidationFee"})` reports `insurancePortion = amount` and a `tier` for a credit that never happened, and the SDK tells integrators to use `SUM(insurancePortion)` as the fund's inflow.
- The SDK TSDoc also says "No `LiquidationFee` rows exist yet: the event is in the protocol ABI but not in the deployed implementation" (`history.ts:575`). That is stale: 692 rows exist.

## Suggested fix
In the liquidation fee path, credit the tier (`InsuranceFund.creditTier(tier, amount)` or the MarginBank's insurance sub-account) in the same call that debits the account, and emit `TierCredited`. Add an invariant test: `getTotalTierBalances() == Σ TierFunded + Σ LiquidationFeeCharged.amount − Σ TierDebited`. If the fee is intentionally kept elsewhere (protocol revenue), rename the event field, fix `insurancePortion`/`tier` in the indexer, and correct the SDK docs.

## Evidence
Outputs above. `011-repro.mts` is in this folder.

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, InsuranceFund 0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80, indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
