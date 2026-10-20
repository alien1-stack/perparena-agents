# Docs say an expired maker makes a fill revert `ExpiredOrderMustBeCancelled`, but perp takers fill straight past expired makers

Severity: normal
Area: docs

Several SDK docs tell bots that an expired resting order blocks matching. They say a taker that reaches it reverts with `ExpiredOrderMustBeCancelled`, and that the fix is to sweep and retry:

- `docs/how-to/run-a-quoting-loop.md` ("Set an expiry so a crashed bot's quotes die"): "Expiry is lazy: an expired order stays on the book until a cancel or a fill attempt touches it, and a fill attempt reverts with `ExpiredOrderMustBeCancelled`."
- `docs/how-to/handle-errors.md`: `case "ExpiredOrderMustBeCancelled": // An expired maker sits in the way. Sweep the expired orders, then retry.` (the code calls `listSweepableOrders` + `cancelExpiredOrders` and then retries `placeOrder`)
- `docs/ENGINE.md` (error-handling example) and the `ContractRevertError` TSDoc in `src/errors.ts`: the same "`ExpiredOrderMustBeCancelled` → cancel first" branch around `placeOrder` / `createOrder`.

On the live perp pools that is not what happens. The matching loop skips an expired maker. It doesn't evict the maker, doesn't emit `OrderExpired` and doesn't revert. The SDK's own internals already say so: `src/store.ts:1832-1836` ("the matching engine walks past an expired maker without evicting it or emitting OrderExpired (anti-griefing, F-2026-16202)") and the `listSweepableOrders` TSDoc ("They are **not matched against** — the matching loop skips an expired maker"). The public how-to pages and examples were never updated.

## Steps to reproduce
1. Run `npx tsx 009-repro.mts` (read-only, `@somnia-chain/markets-sdk@0.32.1` + viem). For each of the 21 perp pools it:
   - takes the expired makers that the indexer still lists as `Open` (lazy expiry);
   - finds a later taker fill on the opposite side at a price worse than that maker's, which means the taker walked past the maker's price level;
   - reads `getOrder(id)` one block before the fill to confirm the expired maker was still stored with its full size, and reads the fill tx receipt.
2. Optional cross-check on XRP: since the 21 expired asks at 1.2924–1.2941 lapsed (by ts 1792487907), the indexer has 615 taker-buy fills on XRP up to 1.3054. All 21 asks are still stored today with untouched `quantityRemaining`.

## Expected
Either the docs describe the live behaviour: an expired maker is skipped and stays stored with its collateral locked until the owner or a sweeper cancels it, and `ExpiredOrderMustBeCancelled` comes from `reduceOrder`/amend on your own expired order (as `src/trade.ts:343` and `src/tradeAbi.ts:40` say). Or a fill through an expired maker reverts as documented.

## Actual
Run twice (2026-10-20, ~13:50 and ~13:57 UTC), same output both times:
```
SUI expired bid 129127208515967940351 @ 1.1922 (expired true, stored at block 16515177, qtyRemaining 83000000000) | taker sell filled @ 1.192 in 0xec42907c05f78a83c64ee3853b447e4e8c119696e2ec61609a601aeab466f026 block 16515178: receipt success
XLM expired bid 221360928884514893281 @ 0.2149 (expired true, stored at block 16514859, qtyRemaining 4650000000) | taker sell filled @ 0.2148 in 0x11a2a87889a74311f0d65686a684a224e69361f3d4799203ce409ad5d345bc91 block 16514860: receipt success
ADA expired bid 73786976294838726261 @ 0.2734 (expired true, stored at block 16514497, qtyRemaining 256000000) | taker sell filled @ 0.2733 in 0x22d8c5e60335ff166bb6d331e1d163f4d9951331899d510199acf92a89aa3aac block 16514498: receipt success
XRP expired ask 590295810358709846044 @ 1.2924 (expired true, stored at block 28361855, qtyRemaining 1547500000) | taker buy filled @ 1.2927 in 0xbb96042d9705bf0e34c9b2f243c26dc0e75b8a19fc1648e71b6e1a8f10bcff7f block 28361856: receipt success
pools/sides where a taker filled past a stored expired maker without reverting: 4
```
A second XRP example: taker bid order `756316507022095815374` (limit 1.3065) filled at 1.2943 in `0x7d030d401ea3704b18f7d35c2143f230c720bacc1c090e3158159163e3b195a0` (block 28362825, status success). One block earlier, all 21 expired asks priced 1.2924–1.2941 were stored and already expired.

## Impact
- A bot built from `handle-errors.md` adds a sweep-and-retry branch that never fires on perps. Meanwhile its own expired quotes keep collateral locked and never self-clean, because fills don't "touch" them either. We checked 7 of the 21 XRP owners (e.g. `0x15608d91322777ca630c76218447421889a06732`), and each still shows ~200 USDso `lockedCollateral` with no unexpired order anywhere, so the lock sits on an order that can never fill. `getOwnOpenOrders()` and `getAllOpenOrdersOffChain` don't return it, so only the indexer or `listSweepableOrders` can find it.
- The "set a short expiry so a crashed bot's quotes die" advice is only half true. The quotes stop filling, but the margin stays locked until someone cancels them.

## Suggested fix
Update `run-a-quoting-loop.md`, `handle-errors.md`, `ENGINE.md` and the `ContractRevertError` TSDoc example. State that matching skips expired makers without evicting them, and that `ExpiredOrderMustBeCancelled` belongs to reduce/amend of your own expired order. Then add "cancel your expired orders to release their locked collateral (`listSweepableOrders({ owner })` → `cancelExpiredOrders`)" to the quoting-loop guide.

## Evidence
Output above, and `009-repro.mts` in this folder.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
