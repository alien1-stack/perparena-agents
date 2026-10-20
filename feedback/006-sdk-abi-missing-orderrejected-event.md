# SDK pool event ABI cannot decode the `OrderRejected` log that the perps docs tell bots to read

Severity: normal
Area: SDK

The perps developer docs ("An IOC that fills nothing reverts") say that in a batch (`placeOrdersFor`), a refused request does not revert and "its `OrderRejected` log carries reason `5`". `@somnia-chain/markets-sdk@0.32.1` ships no ABI fragment for that event. None of the exported `*EventsAbi` constants, and nothing else under `src/`, contains `OrderRejected`. A bot that decodes pool logs with the SDK ABIs, which is the documented "watch from chain" path, silently drops every rejection.

## Steps to reproduce
1. In a project with `@somnia-chain/markets-sdk@0.32.1`, `viem` and `tsx`, run `npx tsx 006-repro.ts` (read-only). It pulls the last 4,000 blocks of logs for the MarginBank, a perp pool (BTC-PERP) and the other system contracts, then diffs every `topic0` against all 81 event selectors exported by the SDK ABIs.
2. `grep -rn OrderRejected node_modules/@somnia-chain/markets-sdk/src` returns nothing.

## Expected
Every event a perp pool emits, and in particular the one the docs name, can be decoded with the SDK's exported event ABIs.

## Actual
```
ADDR btcPool 0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0 topics 8 unknown 1
  0xa8d29afa5f94c3b7716775d4d634f8b829870b24615782f87b7796a33f7c3057 x8
  known: OrderPlaced x1130 OrderRested x999 OrderCancelled x803 OrderCancelledSelfMatch x7 OpenInterestUpdated x295 OrderFilled x295 OrderExpired x6
```
`keccak256("OrderRejected(address,uint8,uint256)") = 0xa8d29afa5f94c3b7716775d4d634f8b829870b24615782f87b7796a33f7c3057`. That is the unknown topic: indexed owner, indexed reason (e.g. `5` = `ImmediateOrCancelNoFill`), and one data word.

## Impact
Live bots can't see their own rejected batch legs (e.g. `PostOnlyWouldCross`, `ImmediateOrCancelNoFill`) from chain. They must poll the indexer (`listPerpOrderRejections`) instead, with indexer lag. The docs point readers to a log they can't decode with the SDK.

## Suggested fix
Add `event OrderRejected(address indexed owner, uint8 indexed reason, uint256 <requestIndex|orderId>)` to `perpPoolEventsAbi`, with a decoder that maps `reason` through `PERP_ORDER_REJECTION_REASON`.

## Evidence
Output above, captured 2026-10-20 ~13:30 UTC. The scan script is in this folder.

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.57.7, Node 22, Somnia Tokyo testnet (chain 50383), read-only.
