# `getMaxPerpOrderSize` / `previewPerpOrderMargin` charge the leverage-setting surcharge on the target market only; the chain charges it on every capped market, so the SDK "Max" order reverts `InsufficientMarginForOrder`

Severity: major
Area: SDK

The SDK sells `getMaxPerpOrderSize` as the number a **Max** button should use, and `previewPerpOrderMargin` as "the accurate gate":

> It does not re-derive the sizing rule; it **binary-searches the forward one**, so the two cannot disagree. That matters because a max computed by a second, subtly different rule reverts on placement. (`docs/PERPS.md:152-154`)

The forward rule (`perpOrderMarginQuote`, `src/perp/margin.ts:2152-2173`) adds a `leverageSurcharge` when the account's leverage setting is stricter than the market IMF (for example 10x on a 20x market). It charges that surcharge only on the **target market's** post-fill notional:

```ts
const existingNotional = (abs(p.positionSize) * p.markPrice) / p.oneBase;   // this pool only
const additionalNotional = (increasingQuantity * p.price) / p.oneBase;
const leverageSurcharge = ... (existingNotional + additionalNotional) * (appliedImBps - p.effectiveImfBps) / 10000
```

The chain's placement gate (`InsufficientMarginForOrder`) also charges the surcharge for **every other market** where the account holds a position under a stricter leverage setting (or under the voucher leverage cap). So for any cross-margin account with a leverage setting in two or more markets, the SDK over-states the affordable size. Its "max" order, and any size between the true max and the SDK max, reverts on placement while the preview says `sufficient: true`.

This was confirmed exactly, not approximately. Solving the SDK's own inequality with one extra term, `Σ_other markets |size|·mark·(levImBps − imfBps)/1e4`, reproduces the chain's accepted maximum **to the lot** on 6 of 6 accounts. Without that term it reproduces the SDK's `maxQuantity`, also to the lot. The over-statement ranged from 2.25% to 41%.

## Steps to reproduce
1. Run `npx tsx 013-repro.mts` (read-only; `@somnia-chain/markets-sdk@0.32.1`, `viem`, `tsx`). You can also pass `<account> <symbol>` pairs. For each case it:
   - calls `client.getMaxPerpOrderSize({ pool, marginBank, account, isBid: true, price, autoPull: true })` for a PostOnly bid 3% under the mark (so it rests, with no adverse-gap term and no fill);
   - simulates `PerpPool.placeOrder(true, 0, price, maxQuantity, MAX_U64, 3 /*PostOnly*/, 0, 0x0, 0)` with `eth_call` from the account, **at the SDK's own `asOfBlock`**. Nothing is signed or sent;
   - binary-searches the largest quantity the chain accepts at that block;
   - reads the account's positions and leverage settings at that block, and solves the SDK inequality with and without the other markets' surcharge;
   - calls `previewPerpOrderMargin` at `maxQuantity` and simulates again at the preview's `asOfBlock`.
2. Accounts were found by scanning open positions for leverage settings stricter than the IMF in two or more markets (9 of the first 600 multi-market accounts).

## Expected
`getMaxPerpOrderSize().maxQuantity` (with `placeable: true`) can be placed at its `asOfBlock`, and `previewPerpOrderMargin().sufficient === true` means the placement passes the margin gate, as the docs promise.

## Actual
Run 1 (2026-10-20):
```
BTC 0x215e7d2e597a202f964b2a816c67eebc5a607897 block 28551277, PostOnly bid 80590000000000000000000 (mark 83082546457629400500000)
  other-market leverage surcharge: ETH 10x on 5% IMF: +33.24; SOL 10x on 5% IMF: +31.20
  SDK getMaxPerpOrderSize: maxQuantity 22204000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28551277: InsufficientMarginForOrder
  SDK previewPerpOrderMargin(maxQuantity) @28551349: sufficient true meetsInitialMargin true; eth_call placeOrder @28551349: InsufficientMarginForOrder
  largest size the chain accepts @28551277: 21405000 (SDK max is 3.73% higher)
  rule solved @28551277: target-market surcharge only = 22204000; plus other markets' surcharge = 21405000
SUI 0x3982e3930efd87fe1bad4cd66e2c1fb38f306501 block 28551371, PostOnly bid 1008500000000000000 (mark 1039787959935000000)
  other-market leverage surcharge: BNB 2x on 10% IMF: +120.44; LINK 5x on 10% IMF: +16.40; XRP 5x on 5% IMF: +67.19; AVAX 5x on 10% IMF: +17.27
  SDK getMaxPerpOrderSize: maxQuantity 6771000000000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28551371: InsufficientMarginForOrder
  largest size the chain accepts @28551371: 5674000000000 (SDK max is 19.33% higher)
  rule solved @28551371: target-market surcharge only = 6771000000000; plus other markets' surcharge = 5674000000000
AVAX 0xd631b6253990e7669e8cb5100c375ed2f8142122 block 28551478, PostOnly bid 9568000000000000000 (mark 9864185138230500000)
  other-market leverage surcharge: XRP 5x on 5% IMF: +18.76; SUI 5x on 10% IMF: +33.26
  SDK getMaxPerpOrderSize: maxQuantity 710800000000000000000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28551478: InsufficientMarginForOrder
  largest size the chain accepts @28551478: 683600000000000000000 (SDK max is 3.98% higher)
  rule solved @28551478: target-market surcharge only = 710800000000000000000; plus other markets' surcharge = 683600000000000000000
SOL 0x34a9df25049ff6509e8c0d6aad36052764f1837d block 28551591, PostOnly bid 104250000000000000000 (mark 107479941139252000000)
  other-market leverage surcharge: HYPE 2x on 5% IMF: +230.89; NEAR 2x on 10% IMF: +204.19
  SDK getMaxPerpOrderSize: maxQuantity 28730000000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28551591: InsufficientMarginForOrder
  largest size the chain accepts @28551591: 20380000000 (SDK max is 40.97% higher)
  rule solved @28551591: target-market surcharge only = 28730000000; plus other markets' surcharge = 20380000000
```
Run 2 (about 15 minutes later, different accounts/markets):
```
BTC 0x215e7d2e597a202f964b2a816c67eebc5a607897 block 28552084, PostOnly bid 80551500000000000000000 (mark 83042839353003338000000)
  other-market leverage surcharge: ETH 10x on 5% IMF: +33.22; SOL 10x on 5% IMF: +31.17
  SDK getMaxPerpOrderSize: maxQuantity 22191000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28552084: InsufficientMarginForOrder
  SDK previewPerpOrderMargin(maxQuantity) @28552168: sufficient true meetsInitialMargin true; eth_call placeOrder @28552168: InsufficientMarginForOrder
  largest size the chain accepts @28552084: 21392000 (SDK max is 3.74% higher)
  rule solved @28552084: target-market surcharge only = 22191000; plus other markets' surcharge = 21392000
ETH 0x2bfe0d4f27a1749e8b37352fc1b6f5160d0b1480 block 28552181, PostOnly bid 2387040000000000000000 (mark 2460870838999179500000)
  other-market leverage surcharge: SUI 5x on 10% IMF: +32.21; DOGE 5x on 10% IMF: +10.71; HYPE 10x on 5% IMF: +53.77; AVAX 5x on 10% IMF: +11.14
  SDK getMaxPerpOrderSize: maxQuantity 12633900000000000000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28552181: InsufficientMarginForOrder
  largest size the chain accepts @28552181: 11730500000000000000 (SDK max is 7.70% higher)
  rule solved @28552181: target-market surcharge only = 12633900000000000000; plus other markets' surcharge = 11730500000000000000
SUI 0xe0d908a689ea60960668fa01876536c9b8b82100 block 28552296, PostOnly bid 1006800000000000000 (mark 1038006119219000000)
  other-market leverage surcharge: HYPE 2x on 5% IMF: +22.33; XRP 2x on 5% IMF: +22.48
  SDK getMaxPerpOrderSize: maxQuantity 20250000000000 placeable true limitedBy initialMargin
  eth_call placeOrder(maxQuantity) @28552296: InsufficientMarginForOrder
  largest size the chain accepts @28552296: 19804000000000 (SDK max is 2.25% higher)
  rule solved @28552296: target-market surcharge only = 20250000000000; plus other markets' surcharge = 19804000000000
```
`previewPerpOrderMargin` reads the head again, so its `sufficient` reflects a later block. On the BTC account it says `sufficient: true` for a size that `eth_call` rejects at that same block. On the others the mark had moved enough by then that the SDK's own preview also turned false.

## Impact
- A **Max** button or slider built as the docs instruct offers sizes that revert, by up to 41% here. The trader sees an `InsufficientMarginForOrder` revert for a size the UI said was affordable, and pays gas for it. Bots that size off `maxQuantity` (the developer page's own "Size and place an order" example) fail on every cycle for these accounts.
- `previewPerpOrderMargin().sufficient` / `meetsInitialMargin` are wrong in the same direction, so order forms show a green check on orders that will revert.
- It affects exactly the users who use the risk control the app exposes (a per-market leverage setting) or carry the paper-USDso voucher cap, once they hold more than one market. Single-market accounts are unaffected, which is probably why the SDK's tests pass.
- Not a fund-loss bug: the chain is the stricter side.

## Suggested fix
In `readPerpPlacementState`, also read `getMaxLeverage(account, p)` and the health snapshot for every pool in `getAccountState().activePerpPools` (or expose a bank view returning the account-wide order IM requirement), and add `Σ_other |size_i|·mark_i·max(0, levImBps_i − imf_i)/1e4` to the requirement in `perpOrderMarginQuote`. Apply the same voucher-cap substitution per market as `_meetsIM` does. Add a test that a two-market capped account's `maxQuantity` passes `eth_call placeOrder` and `maxQuantity + lotSize` does not.

## Evidence
Outputs above. `013-repro.mts` is in this folder.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql. Read-only: orders are simulated with `eth_call` only, nothing is signed or broadcast.
