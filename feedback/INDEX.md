# Feedback index

Every item has a repro script next to it (`0NN-repro.*`; 019 also has `019-repro-b.mts`) that a judge can run read-only. The *first public commit* column is the git timestamp when the item first appeared in this public repo, for first-reporter checks.

| # | Item | Severity | Area | First public commit (UTC) |
|---|---|---|---|---|
| [001](001-systeminfo-reports-tusdc.md) | `getSystemInfo().usdc` and `faucet()` report tUSDC on a perps setup whose margin is USDso | normal | SDK | 2026-10-20 10:58:29Z |
| [002](002-crossed-book-limit-orders-rest.md) | At the market-wide OI cap, crossing limit orders rest instead of matching (crossed book on NEAR/XRP/BTC) | major | contracts | 2026-10-20 10:58:29Z |
| [004](004-perp-doctor-price-rounding.md) | bot kit `perp:doctor` rounds prices ≥ 1 to 2 decimals and hides the real book on 0.0001-tick markets | normal | SDK | 2026-10-20 10:58:29Z |
| [005](005-perp-doctor-crashes-on-example-env.md) | `npm run perp:doctor` crashes with a raw stack trace when run with the `.env.example` key placeholder | normal | SDK | 2026-10-20 10:58:29Z |
| [006](006-sdk-abi-missing-orderrejected-event.md) | SDK pool event ABI cannot decode the `OrderRejected` log that the perps docs tell bots to read | normal | SDK | 2026-10-20 13:27:55Z |
| [007](007-indexer-entryfundingindex-stale.md) | Indexer `PerpPosition.entryFundingIndex` is stale for long-held positions (23/476 rows disagree with the MarginBank) | normal | API | 2026-10-20 13:31:53Z |
| [008](008-bankruptcy-price-ignores-equity-when-in-profit.md) | `getBankruptcyPrice` returns the entry price for every position not at a loss, ignoring the account's equity (it sits inside the SDK's liquidation price on every profitable position) | major | contracts | 2026-10-20 14:15:34Z |
| [009](009-docs-expired-maker-revert-is-stale.md) | Docs say an expired maker makes a fill revert `ExpiredOrderMustBeCancelled`, but perp takers fill straight past expired makers | normal | docs | 2026-10-20 14:15:41Z |
| [010](010-position-lastupdated-timestamp-always-zero.md) | `Position.lastUpdatedTimestampNs` is 0 on every open position, so `fetchPositions()` dates every position 1970-01-01 | normal | SDK | 2026-10-20 14:15:48Z |
| [011](011-liquidation-fee-never-reaches-insurance-fund.md) | Liquidation fees are taken from traders and logged as going to an Insurance Fund tier, but no tier balance ever grows (about 77,000 USDso in 690 fees is not in the fund) | major | contracts | 2026-10-20 14:42:37Z |
| [012](012-docs-no-backstop-bidders-is-stale.md) | Docs say "No backstop bidders are registered on testnet", but the LiquidationEngine has one and it is taking positions over | normal | docs | 2026-10-20 14:42:44Z |
| [013](013-max-order-size-ignores-other-markets-leverage.md) | `getMaxPerpOrderSize` / `previewPerpOrderMargin` charge the leverage-setting surcharge on the target market only; the chain charges it on every capped market, so the SDK "Max" order reverts `InsufficientMarginForOrder` | major | SDK | 2026-10-20 14:42:50Z |
| [014](014-docs-voucher-leverage-not-locked.md) | Docs say a paper-USDso account's leverage setting "can't be changed" while the voucher remains, but voucher accounts change it on chain in both directions | normal | docs | 2026-10-20 15:14:23Z |
| [015](015-docs-liquidation-fee-charged-below-maintenance.md) | Docs say the liquidation fee comes "only from the surplus" and an account that ends just above maintenance pays nothing, but the full 1% is charged on closes that leave the account below maintenance | normal | docs | 2026-10-20 15:14:30Z |
| [016](016-sdk-liquidation-abi-missing-takeover-band-and-fee-skipped.md) | `liquidationEngineEventsAbi` cannot decode two liquidation outcomes the engine emits alongside many liquidations (`TakeoverBandClamped`, liquidation-fee skipped), and the SDK's kind vocabularies omit them | normal | SDK | 2026-10-20 15:14:38Z |
| [017](017-docs-liquidation-engine-start-block-wrong-chain.md) | PERPS.md says the LiquidationEngine is "deployed and indexed from block 436,735,800", a block 15x past the perps testnet head | normal | docs | 2026-10-20 15:14:41Z |
| [018](018-withdrawable-ignores-initial-margin.md) | `getWithdrawableCollateral` / `getMarginAccount().withdrawable` ignores initial margin, so withdrawing the reported amount reverts `InsufficientMarginAfterWithdrawal` on accounts with open positions | major | contracts | 2026-10-20 15:51:58Z |
| [019](019-docs-adl-order-is-leverage-not-profit.md) | Docs say ADL closes "the most profit relative to equity first", but the armed ADL ranker orders by leverage and ignores profit; and the BTC long side (over 5,000 holders against a 500-holder scan cap) is not ranked at all (merged from former 020) | normal | docs | 2026-10-20 16:24:29Z (SHA-256 commitment, see COMMITMENTS.md); full text 2026-10-20 18:29:37Z |
| 022 | committed, revealed at submission | normal | | 2026-10-20 18:47:16Z (SHA-256 commitment, see COMMITMENTS.md) |
| 023 | committed, revealed at submission | normal | | 2026-10-20 18:47:16Z (SHA-256 commitment, see COMMITMENTS.md) |
| 024 | committed, revealed at submission | normal | | 2026-10-20 19:10:42Z (SHA-256 commitment, see COMMITMENTS.md) |
| 025 | committed, revealed at submission | normal | | 2026-10-20 19:36:36Z (SHA-256 commitment, see COMMITMENTS.md) |

Totals: 22 items, 5 major and 17 normal (18 published in full, 4 committed by SHA-256 until submission).

Withdrawn (files kept in [`../withdrawn/`](../withdrawn/)):
- 003: duplicate of an earlier report by another team.
- 020: merged into 019 (its evidence is now the section "Related: BTC long side exceeds the ADL scan cap"; its repro is `019-repro-b.mts`, byte-identical to `020-repro.mts`).
- 021: withdrawn as too minor (a 1-wei-per-position rounding difference).

Edits after first publication or commitment: items 014-021 got an `## Evidence` section at reveal time to match the bounty template; every item's `## Environment` section was later rewritten to the template (SDK version, network, wallet); 016's evidence now separates transaction hashes from event topic0 hashes; 001 and 005 got repro scripts. For the committed items (019-025) the hashes in COMMITMENTS.md refer to the original text. The pre-edit 019-021 files are **not** in this repo's git history (each was first committed in its edited form). COMMITMENTS.md says how to check each hash: byte-exact originals of 019 and 022-025 are in `commitments/`, and the 020/021 originals are the files in `../withdrawn/` minus their Evidence section.
