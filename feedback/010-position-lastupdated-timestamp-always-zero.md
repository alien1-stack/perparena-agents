# `Position.lastUpdatedTimestampNs` is 0 on every open position, so `fetchPositions()` dates every position 1970-01-01

Severity: normal
Area: SDK

The MarginBank `Position` struct has a `lastUpdatedTimestampNs` field. The SDK passes it through everywhere and documents it as real data:

- `PerpPositionOnchain.lastUpdatedTimestampNs`: "Last position update (nanoseconds)" (`src/perp/state.ts:470`)
- `AccountPosition.lastUpdatedTimestampNs`: "When the position last changed, in Unix nanoseconds" (`src/accountView/positionsTypes.ts:110`)
- `SomniaMarkets.fetchPositions()` turns it into the CCXT-style `timestamp` / `datetime` of every `UnifiedPosition` (`src/unified/exchange.ts:5816`, `const tsMs = Number(pos.lastUpdatedTimestampNs / 1_000_000n)`)

On chain the field is never written. It is 0 on every open position, including positions that changed in the same minute. So every unified position reports `timestamp: 0`, `datetime: "1970-01-01T00:00:00.000Z"`, and the account-view snapshot and `getPerpPosition` return 0 for "when the position last changed".

## Steps to reproduce
1. Run `npx tsx 010-repro.mts` (read-only, `@somnia-chain/markets-sdk@0.32.1` + viem; no key, as `fetchPositions` gets an address-only `account`). It:
   - reads every open position on all 21 perp pools at one block through `MarginBank.getSideHolderStatesPaginated` and counts `lastUpdatedTimestampNs == 0`;
   - takes the latest `PerpPositionChange` rows from the indexer (seconds old) and reads `MarginBank.getPosition` for those accounts;
   - calls `new SomniaMarkets({ ..., account }).fetchPositions()` for one of those accounts.

## Expected
`lastUpdatedTimestampNs` holds the time of the last fill, settlement or funding settlement on the position, as the struct field and the SDK docs say. `fetchPositions()[i].timestamp` is that time, or `undefined` when the protocol doesn't track it.

## Actual
Run 1 (2026-10-20, block 28532987):
```
block 28532987: open positions 10371, with lastUpdatedTimestampNs == 0: 10371
  INCREASE at block 28533935 (ts 1792505284) tx 0x366e0f0594… account 0x47537e3a3ea6e9391f3b26ea45618db6828c8bff -> getPosition size -125594300000000000000 lastUpdatedTimestampNs 0
  REDUCE at block 28533935 (ts 1792505284) tx 0x366e0f0594… account 0xa9d57fac6ef6288bded800210ec38c06da89c636 -> getPosition size -2909500000000000000 lastUpdatedTimestampNs 0
  INCREASE at block 28533913 (ts 1792505282) tx 0x47ab2d852b… account 0x8239544db8718d75111e4aeedc42036742d22e68 -> getPosition size -4740245000 lastUpdatedTimestampNs 0
fetchPositions(0x47537e3a3ea6e9391f3b26ea45618db6828c8bff): ZRO/USDso:USDso short contracts=7021 timestamp=0 datetime=1970-01-01T00:00:00.000Z
fetchPositions(0x47537e3a3ea6e9391f3b26ea45618db6828c8bff): LIT/USDso:USDso short contracts=2927.9 timestamp=0 datetime=1970-01-01T00:00:00.000Z
```
Run 2 (block 28534119):
```
block 28534119: open positions 10317, with lastUpdatedTimestampNs == 0: 10317
  REDUCE at block 28535018 (ts 1792505393) tx 0x8756b07e8a… account 0x47537e3a3ea6e9391f3b26ea45618db6828c8bff -> getPosition size -19421100000 lastUpdatedTimestampNs 0
  REDUCE at block 28535018 (ts 1792505393) tx 0x8756b07e8a… account 0x85c6956392aeea8dcec55e6ded069506f248a831 -> getPosition size 271200000000000000000 lastUpdatedTimestampNs 0
fetchPositions(0x47537e3a3ea6e9391f3b26ea45618db6828c8bff): ZRO/USDso:USDso short contracts=7534.9 timestamp=0 datetime=1970-01-01T00:00:00.000Z
fetchPositions(0x47537e3a3ea6e9391f3b26ea45618db6828c8bff): LIT/USDso:USDso short contracts=531.3 timestamp=0 datetime=1970-01-01T00:00:00.000Z
fetchPositions(0x47537e3a3ea6e9391f3b26ea45618db6828c8bff): VVV/USDso:USDso short contracts=119.73 timestamp=0 datetime=1970-01-01T00:00:00.000Z
fetchPositions rows: 21, with timestamp 0: 21
```
An earlier holder scan (block 28514313) gave the same: 10,538 / 10,538 open positions at 0.

## Impact
- Any CCXT-style consumer of `fetchPositions()` (position age, "opened N minutes ago", sorting, staleness checks) gets 1970 for every position. Nothing flags it: `perpState` is `"ok"` and `info.position` carries the same 0.
- Keepers or analytics that use the field to find "positions untouched for X hours" (e.g. funding not settled) treat every position as 55 years old.

## Suggested fix
Write `lastUpdatedTimestampNs = block.timestamp * 1e9` in `MarginBank.settleTrade` / funding settlement. Until then, the SDK should not present the 0 as a date: map `0n` to `undefined` in `fetchPositions` and document the field as "not populated by the current MarginBank" in `PerpPositionOnchain`/`AccountPosition`.

## Evidence
Outputs above. `010-repro.mts` is in this folder.

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: Node 22, MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394, indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
