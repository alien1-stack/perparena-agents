# PERPS.md says the LiquidationEngine is "deployed and indexed from block 436,735,800", a block 15x past the perps testnet head

Severity: normal
Area: docs

`@somnia-chain/markets-sdk@0.32.1` `docs/PERPS.md:913-914` (liquidation history section):

> Liquidation history is served by the `LiquidationEngine` subscription, which is live — the contract is deployed and indexed from block 436,735,800.

The perps developer docs pin this SDK version to the perps testnet (Hideki, chain 50383, "this page uses version 0.32.1, the one the app runs"). On that chain, block 436,735,800 does not exist yet. The head is about 28.57M, so the number is 15.3x the head and probably comes from another network's deployment record. The LiquidationEngine at `0xA66d3C24…9F4D` has had bytecode since block 202,347. The indexer's first `LiquidationEvent` is at block 10,360,563.

Why it matters: the paragraph gives the start block for exactly one purpose, telling a reader where liquidation history begins. A keeper or analytics bot that backfills `PositionLiquidated` / `LiquidationFeeCharged` from chain with `fromBlock: 436_735_800n` (the documented raw-watch path in the same file) gets an RPC error (`missing block data`). With a clamp to head, it gets an empty history and concludes nothing has been liquidated, while the indexer alone holds more than 1,000 `AccountLiquidated` events since block 10.36M.

## Steps to reproduce
1. Run `npx tsx 017-repro.mts` (read-only, no key; `viem`, `tsx`). It reads the chain id and head, calls `eth_getLogs` on the LiquidationEngine from the documented block, binary-searches archive state for the first block where the LiquidationEngine has bytecode, and reads the earliest indexed `LiquidationEvent`.
2. Compare with `node_modules/@somnia-chain/markets-sdk/docs/PERPS.md` line 914.

## Expected
A start block that exists on the chain the docs target (the deploy block, or the first indexed block 10,360,563), or no block number, with a pointer to `chain_metadata` / the indexer for where history begins.

## Actual
Run 1 (2026-10-20):
```
chain 50383 head 28571125; PERPS.md block 436735800 is 15.3x the head
eth_getLogs(LiquidationEngine, 436735800..+1000) -> {"code":-1,"message":"missing block data","data":null}
LiquidationEngine bytecode: absent/unavailable at 202346, present at 202347
first indexed LiquidationEvent: {"kind":"PositionLiquidated","blockNumber":"10360563","txHash":"0x6b503743de9af62c442852f608f5e83b589392463dc847189d79710e00f18ff7"}
```
Run 2 (head 28571309): identical apart from the head.

## Suggested fix
Replace the number with the Hideki figure (deployed at block 202,347; first liquidation indexed at 10,360,563), or drop the number and say "indexed from the contract's deployment".

## Environment
@somnia-chain/markets-sdk 0.32.1 (`docs/PERPS.md`), Node 22, Somnia Tokyo testnet (chain 50383), LiquidationEngine 0xA66d3C24Ad4a389d863846905D8173e1017e9F4D, RPC https://api.hideki2.infra.testnet.somnia.network, indexer https://hideki-dev.smk.somnia.host/v1/graphql, read-only.
