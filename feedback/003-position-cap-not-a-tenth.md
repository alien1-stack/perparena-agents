# Docs: "position cap is a tenth of the OI cap on most markets" holds on only 10 of 21 markets

Severity: normal
Area: docs

## Steps to reproduce
1. Open https://app.testnet.dreamdex.io/docs/developers/perps-testnet, section "Common pitfalls". It says: "Each account has a position cap per market, **a tenth of the market's open interest cap on most markets**."
2. Run `npx tsx 003-repro.ts` (read-only; needs viem + tsx). It reads `getPerpPoolParameters()` on every perp pool and prints `maxPositionSize / maxOpenInterest`.

## Expected
Most of the 21 markets have `maxPositionSize ≈ maxOpenInterest / 10`.

## Actual
Only 10 of 21 markets do. The other 11 markets don't:
- 8 markets use 1/5: ADA, AVAX, BNB, DOGE, LINK, SUI, XLM, XRP.
- BTC is about 0.36, NEAR about 0.18.
- ZEC's position cap equals the whole OI cap (420 = 420).

The 1/5 markets are all the 10%-IM tier plus XRP. So the rule seems to depend on the tier, not on "most markets". A bot that pre-sizes with `maxOpenInterest / 10`, as the sentence suggests, under-sizes on half the markets. On ZEC it is 10× too small.

## Evidence
```
$ npx tsx 003-repro.ts
block 28310023
1000PEPE  maxPositionSize 13028500     maxOpenInterest 130285600      ratio 0.100 ~1/10
ADA       maxPositionSize 450934       maxOpenInterest 2254678        ratio 0.200 NOT 1/10
AVAX      maxPositionSize 13334.4      maxOpenInterest 66672.2        ratio 0.200 NOT 1/10
BNB       maxPositionSize 140          maxOpenInterest 693.975        ratio 0.202 NOT 1/10
BTC       maxPositionSize 100          maxOpenInterest 277.75         ratio 0.360 NOT 1/10
DOGE      maxPositionSize 1122700      maxOpenInterest 5613590        ratio 0.200 NOT 1/10
ETH       maxPositionSize 399.5612     maxOpenInterest 3995.6125      ratio 0.100 ~1/10
HYPE      maxPositionSize 2381.27      maxOpenInterest 23812.72       ratio 0.100 ~1/10
LINK      maxPositionSize 8528.6       maxOpenInterest 42643.6        ratio 0.200 NOT 1/10
LIT       maxPositionSize 13889.6      maxOpenInterest 138896.6       ratio 0.100 ~1/10
NEAR      maxPositionSize 50000        maxOpenInterest 284607.9       ratio 0.176 NOT 1/10
PUMP      maxPositionSize 8799300      maxOpenInterest 87993700       ratio 0.100 ~1/10
SOL       maxPositionSize 4765.44      maxOpenInterest 47654.44       ratio 0.100 ~1/10
SUI       maxPositionSize 127000       maxOpenInterest 635009         ratio 0.200 NOT 1/10
TAO       maxPositionSize 218.549      maxOpenInterest 2185.491       ratio 0.100 ~1/10
VVV       maxPositionSize 2178.61      maxOpenInterest 21786.14       ratio 0.100 ~1/10
WLD       maxPositionSize 126400       maxOpenInterest 1264000        ratio 0.100 ~1/10
XLM       maxPositionSize 535556       maxOpenInterest 2677780        ratio 0.200 NOT 1/10
XRP       maxPositionSize 68926.4      maxOpenInterest 344632         ratio 0.200 NOT 1/10
ZEC       maxPositionSize 420          maxOpenInterest 420            ratio 1.000 NOT 1/10
ZRO       maxPositionSize 25059.9      maxOpenInterest 250599.5       ratio 0.100 ~1/10

10 of 21 markets have a position cap of ~1/10 of the OI cap
```
The SDK's `client.getPerpRiskParams(pool)` returns the same `maxPositionSize` / `maxOpenInterest`.

Suggested fix: drop the ratio and say "read `maxPositionSize` from `getPerpRiskParams` / `getMaxPerpOrderSize`". Or list the caps per tier.

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.x, Somnia testnet (chain 50383), Node v22.22.0, 2026-10-20 07:55 UTC.
