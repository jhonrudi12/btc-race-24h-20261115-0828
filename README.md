# BTC Race 24h — Breakout Rider

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/jhonrudi12/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/jhonrudi12/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A bot for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261115-0828)
(`btc-race-24h-20261115-0828`): it trades cbBTC/USDC on 1-minute bars with
$1,000 of paper money, long only, one position at a time.

## Strategy

A round trip costs roughly 40 bps on this pool (4 bps fee + 2 bps slippage
+ ~15 bps of price impact per leg at dev-window depth), so the bot does
almost nothing and waits for a real leg:

- **Entry — 1-hour Donchian breakout.** Buy 100% of cash when a bar's
  close breaks above the highest high of the previous 60 bars, after a
  5-bar cooldown following any exit. The order fills at the next bar's open.
- **Exit — whichever comes first.** Take profit at +300 bps over the fill
  price; trailing stop 60 bps below the best close since the fill; stale
  breakout — exit if the position is 120 bars old without hitting either;
  equity guard — flatten if equity has drawn down 8% from its peak.
- **Otherwise flat in cash.** In a downtrend the bot simply does not trade.

On the dev window this design is driven by catching the window's one big
recovery leg while cutting failed breakouts quickly (tight trail, 2-hour
stale exit). It is fully deterministic: no clock, no randomness, no network,
no files — signals come only from the bars and fills in each batch.

## Files

- `main.ts` — the bot (Node 22, `agent-fun/bars-replay/v1`)
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's protocol shim
- `README.md`, `LICENSE` (MIT)
