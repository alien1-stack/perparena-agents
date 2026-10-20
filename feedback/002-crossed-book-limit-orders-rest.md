# At the market-wide OI cap, crossing limit orders rest instead of matching (crossed book on NEAR/XRP/BTC), and getMaxPerpOrderSize still says placeable

Severity: major
Area: contracts

**Two facts that pin the cause**
- **A smaller sell that fit inside the OI headroom filled against the same resting XRP bid** (tx `0x2484fa9c…`). The larger crossing sell rested under it.
- **When `maxOpenInterest` was raised on XRP, NEAR and BTC (seen at 08:23 UTC), all three books uncrossed at once.**

## Steps to reproduce
0. In a folder with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx` installed:
1. Run `npx tsx 002-repro.ts` (read-only). It pins one block, calls `getBookLevels(true/false, 3)` on all 21 perp pools, and for any crossed pool lists the open orders that sit through the touch (`getAllOpenOrdersOffChain`).
2. Run `npx tsx 002-repro.ts <txHash>` for the three transactions below. It decodes the `placeOrder` call (sent through a Safe), prints the book at the parent block and lists the pool's logs.

## Expected
`orderType = 0` is "NormalOrder: fill what crosses, rest the remainder on the book" (SDK `ORDER_TYPE.LIMIT`). A limit sell priced below the best bid fills against that bid first. The best ask on a pool is therefore never below the best bid.

## Actual
- On-chain `getBookLevels` returns best ask < best bid on **NEAR-PERP** (`0x1cd15ae8bff0fe0a7f49233be8b90734775ba454`) and **XRP-PERP** (`0x7058579f3248559963f79adb937c6de9f953e060`). At 07:47 UTC the other 19 perp books were not crossed. By block 28311608 (07:57:16 UTC) **BTC-PERP**, the third market at its OI cap, was crossed too:
  ```
  BTC       OI 277.74986 / maxOI 277.75 (headroom 0.00014)  bestBid 81615.1  bestAsk 81546.3  CROSSED
  ```
- None of the crossing orders is expired. They are plain resting orders from different owners, so self-match prevention does not explain it.
- The crossed state persists. NEAR has been crossed at every sample since block 28284093 (07:11 UTC) and XRP since block 28290093 (07:21 UTC). Both were still crossed at block 28306093 (07:48 UTC).
- **Root symptom:** new `orderType 0` limit orders priced through the opposite side get `OrderPlaced` + `OrderRested` with **no `OrderFilled`**:
  - tx `0x61ef546e…5743f4b` (block 28303415, NEAR): `placeOrder(isBid=false, price=4.7703, qty=61.7, orderType=0)`. The book at block 28303414 had best **bid 4.7799**. The order rested at 4.7703 and filled nothing.
  - tx `0x2921eafe…2f0009a` (block 28303713, XRP): `placeOrder(isBid=false, price=1.2955, qty=245.1, orderType=0)`. The book at block 28303712 had best **bid 1.299**. The order rested and filled nothing.
- The same resting XRP bid at 1.299 (order `368934881474195199677`, owner `0xC1DA…f5b1`) **is** matchable. In tx `0x2484fa9c…ede9526` (block 28304296), a sell `placeOrder(price=1.2971, orderType=0)` filled 19.2 XRP against it at 1.299. Some crossing sells match that bid and others rest under it. Matching is therefore inconsistent, not blocked by the maker.
- Side effects:
  - Another account's post-only quotes on NEAR are rejected over and over. The indexer shows `PerpOrderRejection` rows with reason 3 (`PostOnlyWouldCross`) for owner `0xe8c0…a984`, every 2–3 seconds (blocks 28302873…28302943).
  - Any SDK or bot-kit consumer (`fetchOrderBook`, `watchOrderBook`, perp-core `exchange.fetchOrderBook("NEAR-PERP")`) gets a negative spread. Mid and spread math is then wrong.
  - Takers can buy at the resting ask and sell into the resting bid in the same market for a riskless spread.

## Likely cause: the market-wide open-interest cap
Both crossed markets are pinned at `maxOpenInterest`, and the SDK says that cap is "enforced at FILL" (jsdoc of `getMaxPerpOrderSize`). The numbers line up:

| Read (`getOpenInterest()` / `getPerpPoolParameters().maxOpenInterest` at the block) | OI | maxOI | headroom | outcome |
| --- | --- | --- | --- | --- |
| NEAR, block 28303414 (before the 61.7 NEAR sell) | 284605.7 | 284607.9 | **2.2** | rested, 0 filled |
| XRP, block 28303712 (before the 245.1 XRP sell) | 344610.2 | 344632 | **21.8** | rested, 0 filled |
| XRP, block 28304295 (before the 19.2 XRP sell) | 344610.2 | 344632 | **21.8** | filled 19.2 at 1.299 |

Right now BTC (277.7495 / 277.75), NEAR and XRP are all at 99.99% of the cap. The other 18 markets are at 0.7–50%.

The documented pre-trade check gives no warning. Here is `getMaxPerpOrderSize` for the funded account `0xD71E…Ff50` (the one whose sells rested) at the mark, run at 07:56 UTC:
```
XRP buy  placeable true maxQuantity 7649.7 increasing 7404.6 limitedBy initialMargin | OI headroom 2.6
NEAR buy  placeable true maxQuantity 1002 increasing 1002 limitedBy initialMargin | OI headroom 2.2
BTC buy  placeable true maxQuantity 0.75051 increasing 0.11774 limitedBy initialMargin | OI headroom 0.00014
```
The docs example sizes a BTC order with exactly this call. BTC is one of the capped markets.

A crossing order whose fill would push OI past the cap is neither matched up to the headroom nor rejected (`OpenInterestCapExceeded` exists in the error ABI). The whole order **rests at a crossing price**. From then on, every other crossing order that would add OI also rests behind it, so the book stays crossed. The perps docs don't mention a market-wide OI cap at all; they only cover the per-account `maxPositionSize`.

## Addendum (2026-10-20 ~08:30 UTC): even an OI-neutral match does not happen
`getPerpPosition` on the NEAR-PERP crossing pair (read-only, MarginBank `0x4787…1F394`):
```
NEAR best BID 4.774  owner 0x47537E3A…8bfF  position size -12514 NEAR (short)
NEAR best ASK 4.7703 owner 0xFF3B35D2…9713  position size  -209.7 NEAR (short), ask adds to the short
```
The resting bid is a buy from an account that is **short** 12,514 NEAR, so filling it **closes** short exposure. Matched against the ask, which opens new short exposure, total open interest stays the same. Under the usual definition (sum of long or short sizes) the fill is OI-neutral, yet the two orders stay crossed.

So at the cap, position-reducing liquidity can also end up unmatched. A trader trying to close a short at the OI cap may not get filled even when a counterparty is resting through their price.

Script: `002b-positions.mts` in this folder.

## Update (2026-10-20 08:23 UTC): the caps moved, the books uncrossed
By 08:23 UTC `maxOpenInterest` had risen:

| Market | Old cap | New cap |
|---|---|---|
| XRP | 344,632 | 455,775.82 |
| NEAR | 284,607.9 | 327,299.085 |
| BTC | 277.75 | 319.4125 |

All three books are now uncrossed. That supports the root cause: lifting the cap let the resting crossing orders match. It does not fix the behaviour. Whenever a market reaches its cap again, a crossing limit order that would add OI rests through the opposite side instead of being rejected with `OpenInterestCapExceeded` or matched up to the headroom.

A live monitor that flags crossed books and cap pressure on all 21 markets is here: https://alien1-stack.github.io/alien1-stack/radar/

## Evidence
Scan at block 28305819 (2026-10-20T07:47:37Z):
```
XRP       bestBid 1.299  bestAsk 1.2943  CROSSED
   BID order 368934881474195199677 owner 0xC1DA1F512528b0b77C5fF199904951B7B9Dcf5b1 price 1.299 qtyRemaining 12418.2 not expired
   BID order 442721857769033412800 owner 0xcC4Db3e2bE5e686902Ef097337263a17BDd0A853 price 1.2969 qtyRemaining 92.5 not expired
   ASK order 737869762948386238961 owner 0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF price 1.2943 qtyRemaining 772.8 not expired
   ASK order 498062089990162067314 owner 0xD71Ed28806b9b982eaC36De11Fe941ECBeb3Ff50 price 1.2955 qtyRemaining 245.1 not expired
   ...
NEAR      bestBid 4.774  bestAsk 4.7703  CROSSED
   BID order 848550227390646526110 owner 0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF price 4.774 qtyRemaining 209.4 not expired
   BID order 1125251388496289789784 owner 0x38573e79F174c1702dcfa2398c5D9B7B7Fd56f40 price 4.7721 qtyRemaining 29.3 not expired
   ASK order 571849066285003247938 owner 0xFF3B35D2E03a0054aCEf3Aae71A460590b6C9713 price 4.7703 qtyRemaining 810.1 not expired
   ASK order 350488137400488631391 owner 0xD71Ed28806b9b982eaC36De11Fe941ECBeb3Ff50 price 4.7703 qtyRemaining 61.7 not expired
(all other 19 markets: ok)
```
Limit sell through the bid that rested (NEAR):
```
tx 0x61ef546e469473c9b86c21b2d4b6c2b053b30fda72538cea0b88dc4025743f4b block 28303415 status success
  Safe -> pool 0x1cD15ae8bFf0FE0a7F49233BE8b90734775bA454 placeOrder [false,"0","4770300000000000000","61700000000000000000000000","3369282214000000000",0,0,"0x0000000000000000000000000000000000000000","0"]
  book at parent block 28303414: bids 4.7799, 4.7782, 4.7765 | asks 4.7703, 4.7822, 4.7824
  log OrderPlaced {"orderId":"350488137400488631391",...}
  log OrderRested {"orderId":"350488137400488631391"}
```
Limit sell through the bid that rested (XRP):
```
tx 0x2921eafe51669214248e7fb09492889d4828e6396418739eef87211be0f2009a block 28303713 status success
  Safe -> pool 0x7058579F3248559963f79AdB937c6De9f953E060 placeOrder [false,"0","1295500000000000000","245100000","3369282244000000000",0,0,...]
  book at parent block 28303712: bids 1.299, 1.2952, 1.2951 | asks 1.2955, 1.2956, 1.2958
  log OrderPlaced {"orderId":"498062089990162067314",...}
  log OrderRested {"orderId":"498062089990162067314"}
```
Same bid matched by another limit sell 583 blocks later:
```
tx 0x2484fa9cccbb045cf3c547fc7e26abf0702b558fbead28379974e6429ede9526 block 28304296 status success
  Safe -> pool 0x7058579F...E060 placeOrder [false,"0","1297100000000000000","19200000","3369282301000000000",0,0,...]
  book at parent block 28304295: bids 1.299, 1.2947, 1.2946 | asks 1.2949, 1.2953, 1.2955
  log OrderFilled {"takerOrderId":"442721857769033412631","makerOrderId":"368934881474195199677","quantityFilled":"19200000","makerRemainingQuantity":"12418200000","fillPrice":"1299000000000000000"}
```
Best bid / best ask history (`getBookLevels(_,1)` at a pinned block, X = crossed):
```
28282093 07:08:01  NEAR 4.7788/4.7815 .  XRP 1.2993/1.2998 .
28284093 07:11:21  NEAR 4.7882/4.784 X   XRP 1.3004/1.3009 .
28290093 07:21:22  NEAR 4.7801/4.7644 X  XRP 1.299/1.2987 X
28296093 07:31:23  NEAR 4.7721/4.7665 X  XRP 1.299/1.2955 X
28302093 07:41:24  NEAR 4.7858/4.7703 X  XRP 1.299/1.2961 X
28306093 07:48:04  NEAR 4.7799/4.7703 X  XRP 1.299/1.2949 X
```
(NEAR was also briefly crossed at 06:54–06:58 UTC, blocks 28274093–28276093.)

The same view is reachable with the SDK: `markets.fetchOrderBook(...)` reads the same `getBookLevels`. The coordinator's bot-kit read also saw it: `exchange.fetchOrderBook("NEAR-PERP")` gave bids `[[4.7848,208.9],...]`, asks `[[4.7703,810.1],...]`.

Indexer, post-only rejections on the NEAR pool:
```
PerpOrderRejection(where:{pool:{_eq:"0x1cd15ae8..."}}) -> owner 0xe8c0d36d69a10bea8d00fe45a2fde45527eda984 reason 3 (PostOnlyWouldCross) at blocks 28302873, 28302896, 28302919, 28302943 ...
```

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.x, Somnia testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network), Node v22.22.0, 2026-10-20 (07:40–07:50 UTC). Read-only; no transactions sent.
