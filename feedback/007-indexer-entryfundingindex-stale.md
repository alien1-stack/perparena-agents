# Indexer `PerpPosition.entryFundingIndex` is stale for long-held positions (23/476 rows disagree with the MarginBank)

Severity: normal
Area: API

The markets indexer serves `PerpPosition.entryFundingIndex` on every open position. For positions that haven't changed size in a long time, the value doesn't match the MarginBank's `getPosition(...).entryFundingIndex`. The size still matches, so the row looks current. Anyone computing accrued funding from GraphQL gets the wrong number.

The SDK sidesteps this. `listPerpPositions` TSDoc (`src/perp/state.ts:585-592`) says the entry funding index "is not on this row at all" and to use `client.getPerpPosition`. That statement is itself stale: the live schema does serve the field, non-zero on every open row. So the docs give the wrong reason, and direct GraphQL users get no warning.

## Steps to reproduce
1. Run `npx tsx 007-repro.mts` (read-only, `@somnia-chain/markets-sdk@0.32.1`). For each of the 21 perp pools it takes the 25 open positions with the OLDEST `updatedAtBlock` from the indexer. It compares `entryFundingIndex` with `client.getPerpPosition({ marginBank, account, pool })`, which reads the MarginBank.

## Expected
The indexer's `entryFundingIndex` equals the chain value, or the field is documented as "as of `updatedAtBlock`, not current".

## Actual
```
MISMATCH LINK 0xcd7e9c1994cd31869f5300c9bb049400ec326548 indexer 44635586597096256250000000000000000 chain 80596339435531062500000000000000000 row.updatedAtBlock 16269219 indexerHead 28511255
MISMATCH DOGE 0xfad7c54e84248baa76cf845c46ff3b1716794f62 indexer 316727481453827489352004235375000 chain 632650819636243114352004235375000 row.updatedAtBlock 16249298
MISMATCH SUI 0x4c5a9593e215afda200cd4a0827a937d6a6dae9a indexer 3651977723943914586438400918250000 chain 8094940631415879987913088952000000 row.updatedAtBlock 16268695
...
checked 476 oldest-updated open positions across 21 pools; entryFundingIndex mismatches: 23
```
Sizes match on the same rows (checked separately on BTC/SOL: 0 size mismatches), so the row isn't simply out of date. The funding entry point moved on chain without an indexed position update. A separate SOL sample of 60 recent rows had 2 mismatches, e.g. `0xb9794e95…d30b`: indexer 3.96e35 vs chain 6.84e35.

## Impact
Funding PnL, liquidation previews and any "accrued funding" UI built on GraphQL rows is wrong for these accounts. The size of the error is the funding accrued since the entry index moved. The SDK's own explanation for avoiding the field is inaccurate, which hides the real cause: an event that re-bases the entry index isn't applied to the row.

## Suggested fix
Update `PerpPosition.entryFundingIndex` in the indexer on the event that re-bases it, likely `FundingSettled`/`PositionUpdated` on the MarginBank. Then correct the TSDoc in `listPerpPositions` and PERPS.md.

## Evidence
Output above, from 2026-10-20 ~13:50 UTC, indexer head ~28,511,400. The script is in this folder.

## Environment
@somnia-chain/markets-sdk 0.32.1, Node 22, Somnia Tokyo testnet (chain 50383), indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
