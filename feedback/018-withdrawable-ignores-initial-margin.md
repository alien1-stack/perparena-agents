# `getWithdrawableCollateral` / `getMarginAccount().withdrawable` ignores initial margin, so withdrawing the reported amount reverts `InsufficientMarginAfterWithdrawal` on accounts with open positions

Severity: major
Area: contracts

`MarginBank.getWithdrawableCollateral(account)` is the bank's own answer to "how much can I take out". The SDK passes it through unchanged and documents it as margin-aware:

- `MarginAccount.withdrawable`: "Collateral withdrawable right now (**respects margin requirements**)" (`src/perp/margin.ts:53`, filled by `client.getMarginAccount` from `getWithdrawableCollateral`, `margin.ts:84`).
- The account-view snapshot exposes the same read as `withdrawable`: "Collateral the account can withdraw now" (`src/accountView/positionsTypes.ts:150`, `positionsRead.ts:110`).
- The `repayPerpMainFunding` TSDoc example (`src/perp/linkedWallet.ts:945-946`) withdraws exactly this amount: `const { withdrawable } = await child.client.getMarginAccount(...); if (withdrawable > 0n) await child.trader.withdrawMargin({ marginBank, amount: withdrawable });`
- The bot kit's `perp:doctor` prints it as the account's `withdrawable` (`scripts/perp-doctor.ts:96`).

On the perps testnet the view ignores open positions. On every account checked it equals `unlockedCollateralBalance − creditFloor`, to the wei. `withdraw()` itself enforces `equity − amount ≥ imReq`. So for any account whose positions tie up margin, the "withdrawable" figure is larger than what the bank will release, and withdrawing it reverts `InsufficientMarginAfterWithdrawal()`. The largest amount `withdraw()` accepts is exactly `equity − imReq` from `getAccountHealth`, not the view.

On flat accounts the view and `withdraw()` agree, which shows the view is right only when there is no position to margin.

Why it matters: a "Max" withdraw button, a bot that sweeps profit, or the SDK's own documented recipe all use this number. They fail on chain for most accounts that hold a position. Without a position they work, so the problem first shows up when the trader is exposed. The size of the error is large. In run 1 a 1-market account was shown 18,405 USDso withdrawable while the bank releases 10,610. A 21-market account was shown 435,872 against a real 19,834. The SDK offers no other read that gives the true figure: it is `equity − imReq` (plus any leverage-setting surcharge on the next order), and the caller has to compute it.

## Steps to reproduce
1. In a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx`, run `npx tsx 018-repro.mts [positions=150]`. It is read-only: view calls plus `eth_call` simulations of `withdraw()` with `from` set to the account. Nothing is signed or sent. The script:
   - takes the accounts behind the most recently updated open `PerpPosition` rows from the indexer;
   - for each one, pinned to one block, reads `getWithdrawableCollateral`, `getAccountState`, `getCreditFloor` and `getAccountHealth`, then simulates `withdraw(getWithdrawableCollateral)`;
   - for the first six that revert, binary-searches the largest `withdraw()` the bank accepts and prints it next to `equity − imReq` and the SDK's `getMarginAccount().withdrawable`;
   - control: simulates `withdraw(getWithdrawableCollateral)` on flat accounts.
2. Compare with the `MarginAccount.withdrawable` TSDoc ("respects margin requirements").

## Expected
`getWithdrawableCollateral` (and `MarginAccount.withdrawable`) returns an amount that `withdraw()` accepts: `min(unlocked − creditFloor, equity − imReq)`, floored at 0. At minimum the TSDoc should not say "respects margin requirements", and the linked-wallet example should not withdraw it as is.

## Actual
Run 1 (2026-10-20, head 28,591,908, 120 newest open positions):
```
0x6c2986a550dc4212b49a1710d8466553e3761ce4 (1 open market(s))
    getWithdrawableCollateral 18405.4798  (SDK getMarginAccount().withdrawable 15783.7272)  = unlocked 18405.4798 - creditFloor 0.0000
    eth_call withdraw(18405.4798) -> reverts InsufficientMarginAfterWithdrawal
    largest withdraw() the bank accepts: 10609.6230   equity - imReq = 18341.6575 - 7732.0345 = 10609.6230
0xc8e6ba18fd99cf251c3fb97a2202968b4c186fc0 (1 open market(s))
    getWithdrawableCollateral 12779.8193  (SDK getMarginAccount().withdrawable 14662.5042)  = unlocked 12779.8193 - creditFloor 0.0000
    eth_call withdraw(12779.8193) -> reverts InsufficientMarginAfterWithdrawal
    largest withdraw() the bank accepts: 7336.7298   equity - imReq = 12882.7895 - 5546.0597 = 7336.7298
0x8239544db8718d75111e4aeedc42036742d22e68 (1 open market(s))
    getWithdrawableCollateral 603973.5487  (SDK getMarginAccount().withdrawable 603892.5527)  = unlocked 603973.5487 - creditFloor 0.0000
    eth_call withdraw(603973.5487) -> reverts InsufficientMarginAfterWithdrawal
    largest withdraw() the bank accepts: 387317.2755   equity - imReq = 580585.2482 - 193267.9727 = 387317.2755
0x47537e3a3ea6e9391f3b26ea45618db6828c8bff (21 open market(s))
    getWithdrawableCollateral 435872.4183  (SDK getMarginAccount().withdrawable 452626.5798)  = unlocked 435872.4183 - creditFloor 0.0000
    eth_call withdraw(435872.4183) -> reverts InsufficientMarginAfterWithdrawal
    largest withdraw() the bank accepts: 19833.7939   equity - imReq = 439566.6318 - 419732.8379 = 19833.7939
accounts with an open position and withdrawable > 0: 33; getWithdrawableCollateral == unlocked - creditFloor on 33/33; withdraw(withdrawable) succeeds 12, reverts 21 {"InsufficientMarginAfterWithdrawal":20,"InsufficientCollateral":1}
control, flat accounts: withdraw(getWithdrawableCollateral) succeeds on 6/6
```
The SDK column comes from `getMarginAccount`, which reads at its own (later) head, so it drifts slightly from the pinned figures. It shows the same overstatement.

The 12 successes are accounts whose `unlocked − floor` already fits under `equity − imReq` (small positions against a large balance). Every one of the 21 reverts is an amount the view called withdrawable. On every account we binary-searched (6 per run), the largest accepted amount equals `equity − imReq` to within the 1e-6 USDso search step.

Run 2 (head 28,593,361, 200 newest open positions):
```
0x8f0843bc18a8c95488839e71086ffd95f08cfde6 (1 open market(s))
    getWithdrawableCollateral 8273.4911  (SDK getMarginAccount().withdrawable 8345.4344)  = unlocked 8273.4911 - creditFloor 0.0000
    eth_call withdraw(8273.4911) -> reverts InsufficientMarginAfterWithdrawal
    largest withdraw() the bank accepts: 6481.9493   equity - imReq = 8382.0889 - 1900.1396 = 6481.9493
0xab8b612548cc3f5f9f7e723823be37058d0110b2 (15 open market(s))
    getWithdrawableCollateral 479995.6802  (SDK getMarginAccount().withdrawable 479789.2782)  = unlocked 479995.6802 - creditFloor 0.0000
    eth_call withdraw(479995.6802) -> reverts InsufficientCollateral
    largest withdraw() the bank accepts: 334084.2541   equity - imReq = 469889.7156 - 135805.4614 = 334084.2541
accounts with an open position and withdrawable > 0: 60; getWithdrawableCollateral == unlocked - creditFloor on 60/60; withdraw(withdrawable) succeeds 26, reverts 34 {"InsufficientCollateral":1,"InsufficientMarginAfterWithdrawal":33}
control, flat accounts: withdraw(getWithdrawableCollateral) succeeds on 5/5
```
The `InsufficientCollateral` case is an account in unrealized loss: the view (the unlocked balance) is larger than its equity.

An earlier exploratory scan at head 28,590,956 split the accounts by type. Of 57 paper-USDso accounts with a position, `withdraw(view)` reverted on 25. Of 12 ordinary accounts, it reverted on 12. Example voucher account `0x338f46cb…3e86`: view 388.68 (= 2,388.68 unlocked − 2,000 floor), and the bank accepts 258.31 (= equity 2,386.24 − imReq 2,127.93).

## Suggested fix
Make `getWithdrawableCollateral` return what `withdraw()` enforces: `max(0, min(unlocked − creditFloor, equity − imReq))`, and also respect any linked-wallet principal clamp. Until then, compute it in `getMarginAccount` from `getAccountHealth` instead of passing the view through, and fix the `withdrawable` TSDoc and the `repayPerpMainFunding` example.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, read-only (no wallet, no transactions).
