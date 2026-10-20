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

Repro script: `005-repro.sh` in this folder (read-only, no key). Run it inside a fresh `dreamdex-bot-kit` clone after `npm install`. It passes the `.env.example` value through the environment (the kit loads `.env` with dotenv `override: false`, so this equals `cp .env.example .env` and leaves an existing `.env` alone), then runs the same command with `PRIVATE_KEY` empty for comparison. Output, 2026-10-20 (kit commit 2579866; paths shortened):
```
PRIVATE_KEY in .env.example: 0x...
--- 1) doctor with the .env.example placeholder:
Error: invalid private key, expected hex or 32 bytes, got string
    at privateKeyToAccount (.../node_modules/viem/accounts/privateKeyToAccount.ts:48:37)
    at get walletAddress (.../@somnia-chain/markets-sdk/dist/unified/exchange.js:427:20)
    at main (.../scripts/perp-doctor.ts:51:27)
--- 2) same command with PRIVATE_KEY empty (market view only), first 3 markets:
ZRO-PERP   mark=1.99 · funding 10.950% (pays shorts) · book[bid=1.99 ask=2.00] · tick=0.0001 lot=0.1 minQty=5.1 IM=2000bps
LIT-PERP   mark=3.40 · funding -32.734% (pays longs) · book[bid=3.40 ask=3.40] · tick=0.0001 lot=0.1 minQty=2.8 IM=2000bps
VVV-PERP   mark=25.45 · funding 10.950% (pays shorts) · book[bid=25.43 ask=25.46] · tick=0.001 lot=0.01 minQty=0.44 IM=2000bps
--- crashing line (scripts/perp-doctor.ts:51):
  const me = ctx.exchange.walletAddress as `0x${string}` | undefined;
```

## Environment
- SDK: @somnia-chain/markets-sdk 0.32.1
- Network: Somnia Tokyo testnet (chain 50383, RPC https://api.hideki2.infra.testnet.somnia.network)
- Wallet: n/a (read-only repro, no account needed)
- Other: dreamdex-bot-kit main (cloned 2026-10-20; repro re-checked at commit 2579866), Node 22.
