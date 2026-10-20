# Arena Autopilot

> **Judges, start here:**
> - **[Judge mode: 60-second tour](https://alien1-stack.github.io/alien1-stack/radar/judge.html)** (`docs/judge.html`): live market → carry decision → Somnia Agent verdict → live Tokyo trades → feedback + Carry Leaderboard, in 5 steps.
> - **[Verifiable Decision Timeline](https://alien1-stack.github.io/alien1-stack/radar/timeline.html)** (`docs/timeline.html`): every bot tick from `journal/` with its inputs, risk-officer verdict, deterministic gates, the action taken or refused, and tx hashes you can verify against Somnia RPC in the browser (plus CSV export).
>
> Both are static pages with no wallet, hosted live at the links above (source in `docs/`).

**A market-neutral funding-carry bot for dreamDEX perps on Somnia testnet.**

Most perp bots pick one market and one direction. Arena Autopilot looks at **all 21 dreamDEX perp markets** every tick:

1. It reads live funding from each pool.
2. It holds the side funding *pays* on the best-paying markets.
3. It balances longs against shorts, so the book earns carry without betting on direction.

Every decision and every transaction hash goes into a public journal, and a static dashboard reads that journal.

- **Live market radar (no wallet needed):** https://alien1-stack.github.io/alien1-stack/radar/ (source: `docs/radar.html`)
- **Demo video (40s):** https://github.com/alien1-stack/perparena-agents/blob/main/docs/radar-demo.mp4
- **Radar features:** live top carry pair (market-neutral), Wallet X-Ray for any address (`?wallet=0x...` deep link), **Carry Leaderboard** (top funding harvesters vs bleeders across ~1,260 Arena wallets, "your rank" lookup, refreshes every 60 s), one-click Share on X
- **Bot dashboard:** `docs/index.html` (reads `docs/data.json` written by each tick)
- **Strategy:** `kit/strategies/arena-autopilot/src/tick.ts`
- **Feedback track:** 24 reproduced items (5 major, 19 normal), each with a read-only repro script (20 published, 4 committed by SHA-256 in `feedback/COMMITMENTS.md` until submission). Start at [`feedback/INDEX.md`](feedback/INDEX.md)

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
| `AUTOPILOT_COOLDOWN_HOURS` | 12 | No re-entry into a market for this long after its stop-loss |
| `AUTOPILOT_SOMNIA_AGENT` | off | `advisory`: ask the on-chain AI risk officer and journal its verdict. `gate`: also skip entries unless it approves (see below) |

The [radar](https://alien1-stack.github.io/alien1-stack/radar/) has a **Trade ↗** link on every market (it opens `app.testnet.dreamdex.io/trade/perps/tokyo/<BASE>-PERP`) and a **Run it with Autopilot** button on the top carry pair. The button copies the dry-run command above with `AUTOPILOT_SOMNIA_AGENT=gate` added.

## Mainnet readiness

**Status (checked 2026-10-20): Somnia mainnet has no dreamDEX perp markets yet, so Autopilot cannot trade there today.** The kit refuses to start on mainnet, by design:

- The mainnet indexer (`prd.smk.somnia.host`) returns 0 `PERP` markets.
- `SOMNIA_MAINNET_ADDRESSES` in `@somnia-chain/markets-sdk` (0.30.0 in `kit/`, and 0.32.1, the newest version we checked) has no perp singletons: no `marginBank`, no `perpPoolFactory`, no `priceFeedScheduler`.
- `kit/packages/perp-core/src/config.ts` throws on `NETWORK=mainnet` and leaves the mainnet `OPERATOR_REGISTRY` at `0x000…0`.

The mainnet RPC (`api.infra.mainnet.somnia.network`), indexer (`prd.smk.somnia.host`) and chain id (5031) are already in perp-core's `ENDPOINTS`. Once dreamDEX publishes the mainnet perp addresses, the switch is one environment variable:

```bash
NETWORK=mainnet PRIVATE_KEY=0x<bot key> OWNER_ADDRESS=0x<your wallet> AUTOPILOT_SOMNIA_AGENT=gate DRY_RUN=true npx tsx src/tick.ts
```

That command only works after this small perp-core change, which we have **not** made, because there are no perp markets for it to reach yet:

```ts
// kit/packages/perp-core/src/config.ts: let mainnet through (and delete the `if (raw === "mainnet") throw` block above it)
const PERP_NETWORKS: readonly Network[] = ["hideki", "testnet", "mainnet"];
// kit/packages/perp-core/src/exchange.ts: also import SOMNIA_MAINNET_ADDRESSES, then pick the address set per network instead of always testnet
addresses: config.network === "mainnet" ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES,
```

Then update `@somnia-chain/markets-sdk` to the first release whose `SOMNIA_MAINNET_ADDRESSES` includes `marginBank` and `perpPoolFactory`.

**What else in the code is testnet-only:**

| Where | What | Blocks mainnet? |
|---|---|---|
| `perp-core/src/config.ts` | `NETWORK=mainnet` refused, and `PERP_NETWORKS` is only `hideki`/`testnet` | Yes. This is the guard above |
| `perp-core/src/exchange.ts` | `addresses: SOMNIA_TESTNET_ADDRESSES` is hardcoded | Yes. It needs the per-network pick above |
| `perp-core/src/config.ts` | Mainnet `OPERATOR_REGISTRY` is `0x0` | No. Only stop orders use it, and Autopilot watches stops itself. If you need it, set `OPERATOR_PERMISSIONS_REGISTRY` |
| `arena-autopilot/src/tick.ts` (lines 91, 236) | Equity and margin are divided by `1e18`, not by the quote token's `quoteDecimals` | No. It affects only the journal, the dashboard, and the equity the risk officer sees. Order sizing uses the market's own decimals. Check this if mainnet collateral is not 18-decimal |
| `arena-autopilot/src/somnia-agent.ts` | The risk officer runs on Somnia Shannon testnet (chain 50312) and is paid in STT | No. It is a separate chain from the one you trade on. Gate mode keeps working as long as `SOMNIA_AGENT_PRIVATE_KEY` holds STT |
| `docs/radar.html` | Reads the Tokyo RPC and indexer, and Trade links go to `app.testnet.dreamdex.io` | No. The page shows a "Network: Somnia Tokyo testnet" badge, and these switch when perps launch |

**Safety defaults, unchanged on mainnet:**

| Default | Value |
|---|---|
| `DRY_RUN` | `true`. The bot sends nothing until you set `DRY_RUN=false`. Run dry first on mainnet |
| Leg notional | 100 (`AUTOPILOT_LEG_NOTIONAL_USDSO`) |
| Per-leg stop-loss | 4% (`AUTOPILOT_STOP_LOSS_PCT`) |
| Cooldown after a stop | 12 h (`AUTOPILOT_COOLDOWN_HOURS`) |
| Somnia Agents gate | `AUTOPILOT_SOMNIA_AGENT=gate`. No new legs open unless the on-chain risk officer says `APPROVE` |

**The bot key can never withdraw.** It is linked with [Link a bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) (Perps only), so it can place and cancel orders for your account through `placeOrderFor`. Funds stay in your wallet's account. Link a new bot key on mainnet the same way. Do not reuse a testnet key.

## Somnia Agents: on-chain AI risk officer

Before it opens new legs, each tick can send the target book to Somnia's **LLM Inference agent** (Qwen3-30B, agent id `12847293847561029384`). The agent runs on a 3-validator subcommittee on Somnia Shannon testnet (chain 50312), and an answer is accepted only when 2 of the 3 validators return the same output. The request goes through `SomniaAgents.createRequest` at `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` with an ABI-encoded `inferString` payload.

- **Facts, not prose:** the prompt lists each leg's side, notional and funding APR, and whether the leg receives or pays funding. It also gives net exposure, the per-leg stop-loss, max loss in USDso and as a share of equity, gross leverage, and the pool headroom for each leg (`getMaxPerpOrderSize`, plus the cap that binds it). The bot computes every number, so the model judges them rather than doing arithmetic. The policy asks the model to approve only if: net exposure is at most 10% of gross, every leg receives funding, max loss is at most 5% of equity, gross leverage is at most 3x, and every leg fits its headroom. It must answer `APPROVE|REJECT: <reason referencing the numbers>`.
- **Modes:** `advisory` journals the verdict and trades anyway. `gate` opens no new legs unless the verdict is `APPROVE`; a `REJECT`, no verdict, or an error all block. Exits and stop-losses run first in both modes, so the gate can only reduce risk.
- **Audit trail:** the verdict, the reason, the request and consensus tx hashes, and the receipt links go into `journal/` as a `somnia-agent` event and into `docs/data.json` as `riskOfficer`.
- **Cost:** the deposit is 0.24 STT (0.03 reserve + 3 × 0.07), and unspent funds are rebated. The three calls below cost 0.643 STT in total, gas included. `SOMNIA_AGENT_MAX_DEPOSIT_STT` caps the deposit (default 1). Set `SOMNIA_AGENT_PRIVATE_KEY` to a Shannon wallet that holds STT.

**Gate mode on the live bot (since 2026-10-20 20:05 UTC):** live ticks now run with `AUTOPILOT_SOMNIA_AGENT=gate` and `AUTOPILOT_SOMNIA_REVIEW_EVERY_TICK=1`, so every tick of the real Tokyo book gets an on-chain verdict, and it is written to `journal/` next to the Tokyo trades. The first live review gave APPROVE ("net exposure 0.0% of gross, both legs receive funding, +0.48 USDso/day, max loss 0.8% of equity, gross leverage 0.20x"), request tx `0x2d002ca0a57727696adf87673a3f8fb73f06c3d6050a78ec63ea5a1d417fe32b`. See the [Decision Timeline](https://alien1-stack.github.io/alien1-stack/radar/timeline.html).

Live calls on Shannon testnet, 2026-10-20. The consensus tx is the validator `submitResponse` that reached 2 of 3, about 1 s after the request. Calls 2 and 3 use the structured prompt with hand-written example facts (`--example good|bad`).

| # | Book | Verdict (consensus answer) | Request tx | Consensus tx | Receipts |
|---|---|---|---|---|---|
| 1 | short BTC-PERP 100 at +180% APR, long LIT-PERP 100 at −42% APR, net 0 (old free-text prompt) | **REJECT**: "High risk of adverse price movement due to lack of net exposure hedging." This reason is wrong, which is why the prompt now uses structured facts | [`0xf4d2231b…`](https://shannon-explorer.somnia.network/tx/0xf4d2231b4829a6515ced393d75590ae9fd54fe83fff39e4d7d327b319b62fc7d) | [`0xefbbd6c3…`](https://shannon-explorer.somnia.network/tx/0xefbbd6c3247affb208417bab357a457b28ce4ae1dcd2deeef682fed68db88cd1) | [17364447](https://receipts.testnet.agents.somnia.host/agent-receipts?contractAddress=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776&type=minimal&requestId=17364447) |
| 2 | same two legs, both receiving funding; net 0; equity 500; 0.40x gross; max loss 8 USDso (1.6%); within headroom | **APPROVE**: "net exposure 0.0% ≤ 10%, both legs receive funding with positive expected net funding 0.61 USDso/day, max loss 1.6% ≤ 5%, gross leverage 0.40x ≤ 3x, and all legs fit within pool headroom." | [`0x860c0bb1…`](https://shannon-explorer.somnia.network/tx/0x860c0bb1e8a10fe1d83abc2928ab91695b78f920a5bcb5ee8e2f12cb6ca55efb) | [`0x383ecd66…`](https://shannon-explorer.somnia.network/tx/0x383ecd66486fe8d04ee4658cbbabb1e753e9820c8ea42da5266165b29cb88ff6) | [17364977](https://receipts.testnet.agents.somnia.host/agent-receipts?contractAddress=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776&type=minimal&requestId=17364977) |
| 3 | long BTC-PERP 2000 at +180% APR (pays funding), equity 100, 20x net long, max loss 80 USDso (80%), over the 1500 headroom | **REJECT**: "all legs within pool headroom: NO" | [`0xa369d2dd…`](https://shannon-explorer.somnia.network/tx/0xa369d2dd5db9a21e857f1f9e6000d56134122dc91347cde84ba47cc0653cd506) | [`0x1ef58cf4…`](https://shannon-explorer.somnia.network/tx/0x1ef58cf47b7f438ca71281bd7a279874a3eab086489a8bcc12e2820d60b080a9) | [17365010](https://receipts.testnet.agents.somnia.host/agent-receipts?contractAddress=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776&type=minimal&requestId=17365010) |

```bash
cd kit/strategies/arena-autopilot
npm run risk-officer -- --print good                                              # show the prompt, free
SOMNIA_AGENT_PRIVATE_KEY=0x<shannon key> npm run risk-officer -- --example bad    # new request (~0.21 STT)
npm run risk-officer -- --tx 0x<createRequest tx>                                 # re-read a result, free
AUTOPILOT_SOMNIA_AGENT=gate SOMNIA_AGENT_PRIVATE_KEY=0x<shannon key> NETWORK=hideki PRIVATE_KEY=0x<bot key> OWNER_ADDRESS=0x<app wallet> DRY_RUN=true npx tsx src/tick.ts
```

## Live orders on Somnia testnet

| Time (UTC) | Leg | Fill | Tx (Somnia Tokyo, chain 50383) |
|---|---|---|---|
| 2026-10-20 ~14:39 | short BTC-PERP 0.0012 (funding +132.7% APR, paid to shorts) | 83,209.2 | `0x92e9cf8ebd54b7345a408ec4cea11cb9321572045b70585e44e498463e41d47f` (block 28552745) |
| 2026-10-20 ~14:39 | long LIT-PERP 29.8 (funding −28.8% APR, paid to longs) | 3.3474 | `0xd1b752fb21a8119e6c57900b226d1463ff081d2d83372871df3c633e1aa1b877` (block 28552762) |

| 2026-10-20 ~18:47 | close long LIT-PERP 29.8 (per-leg stop-loss at −4.97%) | 3.18 | `0xa59c900f5f88f5fba9996b4103180fa224ed358715a0c25e411f6b5fbb73903a` |
| 2026-10-20 ~18:47 | re-open long LIT-PERP 31.3 (funding still −35.9% APR, paid to longs) | 3.20 | `0x49ff342d0ec1b103c74201880e137177176d6b3093b3b8b887617de4b53fb307` |

The same-tick re-entry after a stop exposed a churn risk, so the bot now has a stop-loss cooldown (`AUTOPILOT_COOLDOWN_HOURS`, default 12): a market that was stopped out is not re-entered until the cooldown ends.

The bot key `0x775275…Bb47` is linked to the trading wallet with Perps-only access (Link a bot), so it places orders through `placeOrderFor` and can never withdraw. Net exposure ≈ 0 (100 USDso per leg).

## X posts

1. Perps Radar launch: https://x.com/day1onearth/status/2112521157538717800
2. Crossed books at the OI cap: https://x.com/day1onearth/status/2112521385775874107
3. Arena Autopilot funding legs: https://x.com/day1onearth/status/2112521486552465788
4. Wallet X-Ray + carry banner: https://x.com/day1onearth/status/2112552314288693731
5. Somnia Agents risk officer: https://x.com/day1onearth/status/2112552086151778495
6. Carry Leaderboard launch: https://x.com/day1onearth/status/2112624874833191217

## Credits

Built on the MIT-licensed [dreamDEX bot kit](https://github.com/somnia-chain/dreamdex-bot-kit) (`kit/`, unchanged apart from `strategies/arena-autopilot`). Testnet only. This is paper money and not financial advice.
