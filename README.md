# Arena Autopilot

**A market-neutral funding-carry bot for dreamDEX perps on Somnia testnet.**

Most perp bots pick one market and one direction. Arena Autopilot looks at **all 21 dreamDEX perp markets** every tick:

1. It reads live funding from each pool.
2. It holds the side funding *pays* on the best-paying markets.
3. It balances longs against shorts, so the book earns carry without betting on direction.

Every decision and every transaction hash goes into a public journal, and a static dashboard reads that journal.

- **Dashboard:** `docs/index.html` (GitHub Pages)
- **Strategy:** `kit/strategies/arena-autopilot/src/tick.ts`
- **Feedback track items:** `feedback/`

## Who it is for

Perps Arena traders who want their paper USDso working between manual trades, without:
- a server to run;
- a directional bet to babysit;
- handing over their account key. The bot uses a dreamDEX *trading key* that can place and cancel orders but can never withdraw.

## How it works (one tick)

| Step | What happens |
|---|---|
| 1. Scan | `liveFunding` + `liveMark` on every perp pool |
| 2. Rank | Sort by absolute funding APR. Keep markets above `AUTOPILOT_MIN_APR` (default 15%) |
| 3. Balance | Add legs greedily while \|long notional − short notional\| ≤ `AUTOPILOT_NET_CAP_USDSO` |
| 4. Exit | Close a leg if it hit the per-leg stop-loss, its funding fell under `AUTOPILOT_EXIT_APR`, or it left the target book |
| 5. Enter | IOC orders, sized with `getMaxPerpOrderSize`; voucher-blocked markets are skipped, not reverted |
| 6. Publish | Append to `journal/YYYY-MM-DD.jsonl`, rewrite `docs/data.json` + `docs/trades.json` |

Example target book from a live dry run on 2026-10-20: **short BTC-PERP** (funding +226.8% APR, paid to shorts) and **long LIT-PERP** (−40.0% APR, paid to longs). Net exposure: 0.

## Run it

```bash
cd kit && npm install
cd strategies/arena-autopilot
NETWORK=hideki PRIVATE_KEY=0x<bot key> OWNER_ADDRESS=0x<your app wallet> DRY_RUN=true npx tsx src/tick.ts
```

Each command runs one tick. Read the dry-run output first, then set `DRY_RUN=false` to trade.

**Link the bot key first:** in the app, open your wallet, choose **Link a bot**, paste the bot's address, keep Perps ticked, and send it a little STT for gas. See [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot).

| Variable | Default | Meaning |
|---|---|---|
| `AUTOPILOT_LEG_NOTIONAL_USDSO` | 100 | Notional per leg |
| `AUTOPILOT_MAX_LEGS` | 4 | Maximum open legs |
| `AUTOPILOT_NET_CAP_USDSO` | 150 | Maximum \|long − short\| notional |
| `AUTOPILOT_MIN_APR` / `AUTOPILOT_EXIT_APR` | 0.15 / 0.05 | Funding to enter / to stay |
| `AUTOPILOT_STOP_LOSS_PCT` | 4 | Per-leg stop-loss, watched each tick |

## Live orders on Somnia testnet

_Transaction hashes are added here as the bot trades._

## X posts

_Links are added here._

## Credits

Built on the MIT-licensed [dreamDEX bot kit](https://github.com/somnia-chain/dreamdex-bot-kit) (`kit/`, unchanged apart from `strategies/arena-autopilot`). Testnet only. This is paper money and not financial advice.
