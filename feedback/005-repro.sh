#!/usr/bin/env bash
# 005 repro — read-only, no key, no transactions.
# Run inside a fresh clone of somnia-chain/dreamdex-bot-kit after `npm install`:
#   git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit && npm install && bash 005-repro.sh
# The kit loads .env with dotenv `override: false`, so passing the .env.example value in the
# environment is the same as `cp .env.example .env` (and does not touch an existing .env).
PLACEHOLDER=$(grep -m1 '^PRIVATE_KEY=' .env.example | cut -d= -f2-)
echo "PRIVATE_KEY in .env.example: $PLACEHOLDER"
echo "--- 1) doctor with the .env.example placeholder:"
PRIVATE_KEY="$PLACEHOLDER" NETWORK=hideki npm run -s perp:doctor 2>&1 | grep -E "Error|at (privateKeyToAccount|get walletAddress|main)|^[A-Z0-9]+-PERP" | head -8
echo "--- 2) same command with PRIVATE_KEY empty (market view only), first 3 markets:"
PRIVATE_KEY= NETWORK=hideki npm run -s perp:doctor 2>&1 | grep -E "^[A-Z0-9]+-PERP" | head -3
echo "--- crashing line (scripts/perp-doctor.ts:51):"
sed -n 51p scripts/perp-doctor.ts
