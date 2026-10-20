# `npm run perp:doctor` crashes with a raw stack trace when run with the `.env.example` key placeholder

Severity: normal
Area: SDK

The bot kit README and docs/perps.md say to run `npm run perp:doctor` **first** ("it lists the markets ... and says whether your key is ready to trade"). Following the manual setup literally (`cp .env.example .env`, then doctor) crashes before printing anything useful.

## Steps to reproduce
1. `git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit`
2. `npm install`
3. `cp .env.example .env` (it contains `PRIVATE_KEY=0x...`)
4. `NETWORK=hideki npm run perp:doctor`

## Expected
The doctor runs read-only (markets, marks, books) and says the key is missing or invalid, e.g. "PRIVATE_KEY is a placeholder, set a real key to check readiness". The read-only market list is exactly what a new builder needs before they have a key.

## Actual
```
Error: invalid private key, expected hex or 32 bytes, got string
    at normPrivateKeyToScalar (.../@noble/curves/src/abstract/weierstrass.ts:394:13)
    ...
    at privateKeyToAccount (.../viem/accounts/privateKeyToAccount.ts:48:37)
    at get walletAddress (.../markets-sdk/dist/unified/exchange.js:427:20)
    at main (scripts/perp-doctor.ts:51:27)
```
No markets are listed. With a real 32-byte key the same command works (21 markets listed), so the failure is only in the placeholder/no-key path.

## Evidence
Full output above. Cause: `scripts/perp-doctor.ts:51` reads `ctx.exchange.walletAddress`, which calls `privateKeyToAccount("0x...")` without validating the env value first.

## Environment
dreamdex-bot-kit main (cloned 2026-10-20), @somnia-chain/markets-sdk 0.32.1, Node 22, Somnia testnet chain 50383
