# bot kit `perp:doctor` rounds prices ≥ 1 to 2 decimals and hides the real book on 0.0001-tick markets

Severity: normal
Area: SDK

## Steps to reproduce
1. `git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit && npm install` (commit `25798660bbe4674a6f83a960b202852896e2fed4`).
2. Run `NETWORK=hideki npm run perp:doctor`. docs/perps.md says "Run `npm run perp:doctor` first".
3. Compare the XRP-PERP and NEAR-PERP lines with the pools' own `getBookLevels`. Or run `bash 004-repro.sh` from the repo root, which does both.

## Expected
The script's own comment says: "A price with enough digits to read, whether it is 83,000 or 0.0058". Prices should print to tick precision. The same output line already prints `tick=0.0001` for these markets.

## Actual
`px()` in `scripts/perp-doctor.ts:44` is `Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4)`. Every price at or above 1 is cut to 2 decimals, even when the tick is 0.0001. On XRP-PERP (1.299 / 1.2949) and NEAR-PERP (4.7744 / 4.7703), the bid, ask and mark become wrong or identical: `bid=1.30 ask=1.29`, `bid=4.77 ask=4.77`, `mark=1.29`.
- The spread is invisible, so the doctor can't be used to sanity-check quoting.
- The crossed books on these two pools (see 002) show up as `bid=4.77 ask=4.77`.

Prices below 1 (SUI, ADA) print at 4 significant digits and are fine. That makes the inconsistency obvious.

## Evidence
```
$ bash 004-repro.sh        # 2026-10-20 ~07:58 UTC
NEAR-PERP  mark=4.78 · funding 10.950% (pays shorts) · book[bid=4.77 ask=4.77] · tick=0.0001 lot=0.1 minQty=5.1 IM=1000bps
SUI-PERP   mark=0.9894 · funding 10.950% (pays shorts) · book[bid=0.9896 ask=0.9902] · tick=0.0001 lot=1 minQty=13 IM=1000bps
ADA-PERP   mark=0.2164 · funding 10.950% (pays shorts) · book[bid=0.2164 ask=0.2167] · tick=0.0001 lot=1 minQty=46 IM=1000bps
XRP-PERP   mark=1.29 · funding 10.950% (pays shorts) · book[bid=1.30 ask=1.29] · tick=0.0001 lot=0.1 minQty=6.9 IM=500bps
0x7058579f3248559963f79adb937c6de9f953e060 best bid 1.299
0x7058579f3248559963f79adb937c6de9f953e060 best ask 1.2949
0x1cd15ae8bff0fe0a7f49233be8b90734775ba454 best bid 4.7744
0x1cd15ae8bff0fe0a7f49233be8b90734775ba454 best ask 4.7703
```
Code:
```ts
// scripts/perp-doctor.ts:43-44
/** A price with enough digits to read, whether it is 83,000 or 0.0058. */
const px = (v: number) => (Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4));
```
Suggested fix: format with the market's tick decimals (`formatUnits(tickSize, 18)` is already computed on the same line).

## Environment
dreamdex-bot-kit @ 25798660 (2026-10-12), @somnia-chain/markets-sdk 0.32.1, Somnia testnet (chain 50383), Node v22.22.0, 2026-10-20.
