# Position analytics truncate unrealized PnL toward zero, but the MarginBank floors it, so the documented "re-sums to the bank's equity to the wei" fails on 45% of accounts

Severity: normal
Area: SDK

`perpPositionAnalytics` (and `getPerpPositionAnalytics` / `listPerpPositionAnalytics`, which call it) is documented as an exact port of the bank:

- "A direct port of `MarginBank._computePositionMetrics` and `_marketHealthFromSnapshot`, which is what lets the rows re-sum to the bank's own equity to the wei — a test pins that. **The two roundings differ and are not interchangeable**: unrealized PnL truncates toward zero, while funding ceils toward +∞" (`docs/PERPS.md:281-286`).
- `equityContribution`: "Across every active market these add to `equity − collateral`, exactly" (`src/perp/margin.ts:927-930`). The module note says the same (`margin.ts:849-850`).
- The code: "Bare `/` — `PerpMath.unrealizedPnl` truncates toward ZERO" (`margin.ts:986-990`).
- PERPS.md also contrasts this with closes: "`realizedPnl` **floors** toward −∞ [...] the opposite of the truncation unrealized PnL uses — the same inputs give `-1` here and `0` from `getPerpPositionAnalytics`, and both are correct" (`docs/PERPS.md:250-253`).

On the deployed MarginBank, unrealized PnL **floors** toward −∞. For a position at a loss whose `(mark − entry) × size / oneBase` is not exact, the SDK's `unrealizedPnl` and `equityContribution` are 1 wei higher than what the bank counts. On accounts with several losing positions the sum is off by several wei. The funding leg (ceil) is correct.

We checked this on every account behind the 200 most recently updated open positions, all reads pinned to one block. `unlockedCollateralBalance + Σ equityContribution` equals `getAccountHealth().equity` on only 69/125 and 69/124 accounts. The same sum with the PnL leg floored equals it on 125/125 and 124/124. Every mismatch has the SDK above the bank, by exactly the number of losing positions with an inexact division.

Why it matters: the amount is tiny (1 wei per losing position), but the claim is an exact one and code relies on it. A UI or test that asserts the documented invariant, `Σ equityContribution === equity − collateral`, fails on about half of real accounts. The rounding direction is also the unsafe one: the SDK shows a loss as slightly smaller than the bank does. Any SDK code that compares an equity rebuilt this way to a margin threshold can be wrong by a wei at the boundary. The PERPS.md example ("`-1` here and `0` from `getPerpPositionAnalytics`, and both are correct") teaches that the open-position figure and the close figure differ, when on chain they agree.

## Steps to reproduce
1. In a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx`, run `npx tsx 021-repro.mts [positions=200]`. It is read-only: view calls only, all pinned to one block. For each account behind the newest open `PerpPosition` rows, the script:
   - reads `getAccountState` and `getAccountHealth`, and for each active pool `getPosition` and `tryGetHealthSnapshot`;
   - runs the SDK's exported `perpPositionAnalytics` on exactly those inputs (the same reads `listPerpPositionAnalytics` makes);
   - compares `unlocked + Σ equityContribution` with `getAccountHealth().equity`, then repeats the sum with the PnL leg floored toward −∞ and the funding leg unchanged.
2. Compare with `docs/PERPS.md:281-286` and `src/perp/margin.ts:927-930, 986-990`.

## Expected
`unlockedCollateralBalance + Σ equityContribution == getAccountHealth().equity` on every account, as documented.

## Actual
Run 1 (2026-10-20, head 28,610,211):
```
0x420691db9d2b5a79210fda48c177471386b6dfd1 21 market(s), 7 losing with inexact PnL: getAccountHealth().equity 602256331549663599617309  unlocked + Σ SDK equityContribution 602256331549663599617316  (SDK - bank = 7 wei)
0x47537e3a3ea6e9391f3b26ea45618db6828c8bff 21 market(s), 6 losing with inexact PnL: ... (SDK - bank = 6 wei)
0x85c6956392aeea8dcec55e6ded069506f248a831 21 market(s), 5 losing with inexact PnL: ... (SDK - bank = 5 wei)
0x8239544db8718d75111e4aeedc42036742d22e68 1 market(s), 1 losing with inexact PnL: getAccountHealth().equity 577712902943759185418386  unlocked + Σ SDK equityContribution 577712902943759185418387  (SDK - bank = 1 wei)
head 28610211: 125 accounts, 250 positions (78 at a loss with an inexact PnL division)
  unlocked + Σ perpPositionAnalytics().equityContribution == getAccountHealth().equity on 69/125
  same sum with unrealized PnL floored toward -inf                     on 125/125
```
Run 2 (head 28,611,965):
```
0x47537e3a3ea6e9391f3b26ea45618db6828c8bff 21 market(s), 5 losing with inexact PnL: ... (SDK - bank = 5 wei)
0x16ad669f090e3c026ad0253d01c221c4a4c1e9da 3 market(s), 1 losing with inexact PnL: getAccountHealth().equity 1649211303284862355279  unlocked + Σ SDK equityContribution 1649211303284862355280  (SDK - bank = 1 wei)
head 28611965: 124 accounts, 253 positions (73 at a loss with an inexact PnL division)
  unlocked + Σ perpPositionAnalytics().equityContribution == getAccountHealth().equity on 69/124
  same sum with unrealized PnL floored toward -inf                     on 124/124
```
An earlier exploratory pass over single-market accounts (105 accounts) matched the bank on 105/105 only with "PnL floor, funding ceil". "PnL truncate, funding ceil" (the SDK's choice) matched on 59/105.

## Suggested fix
Floor the PnL leg in `perpPositionAnalytics` (`divFloor((mark − entry) × size, oneBase)`), which makes the documented invariant hold. Then correct the PERPS.md rounding note and the realized-vs-unrealized `-1`/`0` example, and check the other SDK code that rebuilds equity from `(mark − entry) × size / oneBase` with bare `/`.

## Evidence
- Repro script: `021-repro.mts` in this folder (read-only: `eth_call`, `eth_getLogs` and indexer queries; it signs nothing). Run with `npx tsx 021-repro.mts` from a project with `@somnia-chain/markets-sdk@0.32.1` installed. The output under **Actual** comes from two separate runs.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, read-only (no wallet, no transactions).
