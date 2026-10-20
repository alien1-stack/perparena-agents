# `getBankruptcyPrice` returns the entry price for every position not at a loss, ignoring the account's equity (it sits inside the SDK's liquidation price on every profitable position)

Severity: major
Area: contracts

`client.getBankruptcyPrice` (→ `MarginBank.getBankruptcyPrice(account, pool)`) is documented in PERPS.md ("Liquidation-keeper reads") and its TSDoc as "the **contract's own figure** — the price at which the position's allocated share of the account's equity is exhausted". The docs say a keeper "pays against this number". They also say it is the later of two points: `getLiquidationPrice` is "where liquidation *starts*" and the bankruptcy price is "where there is nothing left".

We tested this on single-market accounts, where all of the account's equity belongs to the one position, so the "allocated share" can only be all of it. The contract's figure follows a rule that ignores the equity whenever the position is not losing:

- **Position at a loss:** `bankruptcy = entry ∓ unlockedCollateral / size`. This matches to the wei. It is the price where collateral plus unrealized PnL reaches zero, but it leaves out the accrued funding that `getAccountHealth.equity` includes.
- **Position in profit (or flat):** `bankruptcy = avgEntryPrice`, exactly, however much collateral backs it. A short of 1,039 LINK with 101,763 USDso of equity reports a bankruptcy price of 12.647 (its entry). The mark is 12.003, and the price where its equity is actually exhausted is ~109.9.

So for most profitable positions the "bankruptcy" price sits between the mark and the SDK's liquidation price. On the documented semantics that is impossible: bankruptcy can't come before liquidation.

## Steps to reproduce
1. Run `npx tsx 008-repro.mts 8` (read-only, `@somnia-chain/markets-sdk@0.32.1`). For each of the 21 perp pools it enumerates holders with `MarginBank.getSideHoldersPaginated` at one block (the call behind `client.getPerpSideHolders`). It keeps accounts whose `getAccountState.activePerpPools` has length 1 and reads at that same block:
   - `getPosition`
   - `getAccountHealth`
   - the pool's `getHealthSnapshot`
   - `MarginBank.getBankruptcyPrice`, the exact call `client.getBankruptcyPrice` makes

   It then classifies the bankruptcy price against `entry`, `entry ∓ unlocked/size`, the equity-zero price `mark ∓ equity/size`, and the SDK's own `perpLiquidationPrice` (the math behind `getLiquidationPrice`).

## Expected
For a single-market account, `getBankruptcyPrice` ≈ the price where the account's equity reaches zero (`mark ∓ equity·oneBase/|size|`), and it lies beyond `getLiquidationPrice` (further from the mark). If the contract deliberately uses another definition, for example "profitable legs are allocated no collateral" for ADL pricing, PERPS.md and the TSDoc should say that, rather than "price at which the position's allocated share of the account's equity is exhausted" and "what a bankrupt position is worth".

## Actual
Two runs, 2026-10-20, about 1,000 blocks apart (`npx tsx 008-repro.mts 8`, 8 holders per side per pool):
```
block 28530132n
  LINK 0x21391AFCcc25A8f81985a71b5Bf39204095f5769 SHORT size=16.8 entry=15.34900 mark=12.13953 equity=81.87786 | getBankruptcyPrice=15.34900  equity-zero price=17.01321  getLiquidationPrice math=16.20306
  LINK 0xA96689830a200E407e368bfB36C3836B50E1fc1F SHORT size=24.7 entry=15.29600 mark=12.13953 equity=119.3242 | getBankruptcyPrice=15.29600  equity-zero price=16.97047  getLiquidationPrice math=16.16235
  WLD 0x4eFDc5999a81D83926EbEdE58b0eB1115AC134ea LONG size=804 entry=0.4974000 mark=0.5606240 equity=127.6906 | getBankruptcyPrice=0.4974000  equity-zero price=0.4018048  getLiquidationPrice math=0.4464498
  WLD 0x7A6e5C154b186b756B4a5c578b32E64A6b5cbBbA LONG size=260 entry=0.4996000 mark=0.5606240 equity=40.93463 | getBankruptcyPrice=0.4996000  equity-zero price=0.4031831  getLiquidationPrice math=0.4479812
  TAO 0x6500ec116571d035E7d51c2Dbdfd7e5B1A0B4E0A SHORT size=0.957 entry=312.4610 mark=269.4933 equity=103.4307 | getBankruptcyPrice=312.4610  equity-zero price=377.5714  getLiquidationPrice math=343.2467
  TAO 0x18a92689B8f9E28B390fE56C7f508D93C33fd1aD SHORT size=0.859 entry=313.9140 mark=269.4933 equity=94.89184 | getBankruptcyPrice=313.9140  equity-zero price=379.9611  getLiquidationPrice math=345.4192
{
  singleMarketPositions: 40,
  inProfit: 31,
  inProfit_bankruptcyEqualsEntry: 31,
  atLoss: 9,
  atLoss_bankruptcyEqualsEntryMinusCollateral: 9,
  unexplained: 0,
  sdkLiqPriceBeyondChainBankruptcy_inProfit: 31,
  sdkLiqPriceBeyondChainBankruptcy_atLoss: 0
}
```
```
block 28531119n
  LINK 0x21391AFCcc25A8f81985a71b5Bf39204095f5769 SHORT size=16.8 entry=15.34900 mark=12.16262 equity=81.48990 | getBankruptcyPrice=15.34900  equity-zero price=17.01321  getLiquidationPrice math=16.20306
  LINK 0xA96689830a200E407e368bfB36C3836B50E1fc1F SHORT size=24.7 entry=15.29600 mark=12.16262 equity=118.7537 | getBankruptcyPrice=15.29600  equity-zero price=16.97047  getLiquidationPrice math=16.16235
  WLD 0x4eFDc5999a81D83926EbEdE58b0eB1115AC134ea LONG size=804 entry=0.4974000 mark=0.5567612 equity=124.5849 | getBankruptcyPrice=0.4974000  equity-zero price=0.4018048  getLiquidationPrice math=0.4464498
  WLD 0x7A6e5C154b186b756B4a5c578b32E64A6b5cbBbA LONG size=260 entry=0.4996000 mark=0.5567612 equity=39.93030 | getBankruptcyPrice=0.4996000  equity-zero price=0.4031831  getLiquidationPrice math=0.4479812
  TAO 0x6500ec116571d035E7d51c2Dbdfd7e5B1A0B4E0A SHORT size=0.957 entry=312.4610 mark=269.5158 equity=103.4092 | getBankruptcyPrice=312.4610  equity-zero price=377.5714  getLiquidationPrice math=343.2467
  TAO 0x18a92689B8f9E28B390fE56C7f508D93C33fd1aD SHORT size=0.859 entry=313.9140 mark=269.5158 equity=94.87250 | getBankruptcyPrice=313.9140  equity-zero price=379.9611  getLiquidationPrice math=345.4192
{
  singleMarketPositions: 40,
  inProfit: 31,
  inProfit_bankruptcyEqualsEntry: 31,
  atLoss: 9,
  atLoss_bankruptcyEqualsEntryMinusCollateral: 9,
  unexplained: 0,
  sdkLiqPriceBeyondChainBankruptcy_inProfit: 31,
  sdkLiqPriceBeyondChainBankruptcy_atLoss: 0
}
```
An earlier, wider scan of 149 single-market accounts (10 per pool, block 28524511) gave the same split: 74/74 in-profit positions returned exactly `avgEntryPrice`, 75/75 losing positions returned `entry ∓ unlocked/size`, and 0 were unexplained. On 97 of them the SDK liquidation price lay beyond the chain bankruptcy price.

Every single-market position fits the two-branch rule exactly (`unexplained: 0`). Every position in profit returns its entry price, so on every one of them the SDK's `getLiquidationPrice` math sits further from the mark than the "bankruptcy" price. Example: TAO short `0x6500…4E0A` has entry 312.46 and mark 269.5. The SDK says liquidation starts at 343.25 and equity runs out at 377.57, but `getBankruptcyPrice` says 312.46.

## Impact
- A keeper or UI that follows the docs and uses `getBankruptcyPrice` as "where this position has nothing left" shows a profitable, well-collateralised position as already bankrupt (short) or bankrupt at break-even (long). The liquidation price from the same SDK sits on the far side of it.
- Even on the losing branch the figure ignores accrued funding, so it drifts from `getAccountHealth.equity`. Example: LINK long `0x305B0b5ede4301E26b137Bca2a53BC043d585556` has chain bankruptcy 6.3946, but the equity-zero price including funding is 6.4473.

## Suggested fix
Either compute the bankruptcy price from the position's allocated equity (including funding) in both branches, or keep the current rule if ADL needs it and document it. In that case: "profitable positions are allocated no collateral, so their bankruptcy price is their entry; it is not where the position's equity runs out". Then rewrite the keeper section of PERPS.md and the `getBankruptcyPrice` TSDoc to match.

## Evidence
Output above. `008-repro.mts` is in this folder.

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, read-only.
