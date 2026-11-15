// Breakout rider for cbBTC 1-minute bars (agent-fun/bars-replay/v1).
//
// Idea: on a 24h window of 1-minute bars BTC mostly chops sideways and then
// makes a few real legs. A round trip costs roughly 40 bps (4 bps fee +
// 2 bps slippage + ~15 bps of pool impact per leg at dev-window depth), so
// chasing every 1-minute wiggle bleeds out. This bot therefore does almost
// nothing: it sits in cash and only buys a genuine breakout, then rides it
// with a tight trailing stop and a take-profit, and gives up on a breakout
// that has not paid off within two hours.
//
// Entry (long only, one position, 100% of cash):
//   - the bar's close breaks above the highest high of the previous 60 bars
//     (a 1-hour Donchian breakout), and
//   - at least 5 bars have passed since the last exit (cooldown, so a
//     whipsawed exit is not re-bought on the next bar).
// The order fills at the next bar's open.
//
// Exit (whole position, whichever comes first):
//   - take profit: close is 300 bps above the fill price;
//   - trailing stop: close has fallen 60 bps from the highest close since
//     the fill (the trail only ever moves up, so a fast leg keeps most of
//     its gain and a failed breakout is cut quickly);
//   - stale breakout: the position is 120 bars old without hitting either
//     of the above;
//   - equity guard: equity has drawn down 8% from its peak, flatten now.
//
// Everything is deterministic: prices come only from the bars in each
// batch, the fill prices from the batch's fills, and there is no clock,
// no randomness and no I/O besides the protocol lines. Two runs on the
// same bars therefore produce the same orders.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// How many prior bars define the breakout high (one hour of 1-minute bars).
const LOOKBACK_BARS = 60;
// Take profit, in basis points above the fill price.
const TAKE_PROFIT_BPS = 300;
// Trailing stop, in basis points below the best close since the fill.
const TRAIL_BPS = 60;
// Give up on a breakout after this many bars without a profit/stop exit.
const MAX_HOLD_BARS = 120;
// Bars to wait after an exit before a fresh entry.
const COOLDOWN_BARS = 5;
// Flatten everything if equity falls this far (bps) from its peak.
const EQUITY_GUARD_BPS = 800;
// Slippage cap on every order, in bps from the latest close.
const MAX_SLIPPAGE_BPS = 100;

// High of every bar seen so far, oldest first; only the last LOOKBACK_BARS
// are ever read, so the array is trimmed as it grows.
const highs: number[] = [];

// Fill price of the open position (raw price units, as in bar.c), the best
// close since the fill, the batch seq of the fill, and the batch seq of the
// last exit fill. All of these are set from the harness's own fills, never
// guessed from an order we sent.
let fillPrice: number | null = null;
let bestClose: number | null = null;
let fillSeq = -1;
let lastExitSeq = -1_000_000;

// Highest equity seen (micro-USDC), for the equity guard.
let peakEquity = 1_000_000_000n;

function breakoutHigh(): number | null {
  if (highs.length < LOOKBACK_BARS) return null;
  let top = -Infinity;
  for (let i = highs.length - LOOKBACK_BARS; i < highs.length; i++) {
    if (highs[i]! > top) top = highs[i]!;
  }
  return top;
}

// Record this batch's high after deciding, so a breakout test always
// compares the close against the previous 60 bars alone.
function recordHighs(batch: Batch): void {
  for (const b of batch.bars) {
    if (b.symbol !== SYMBOL) continue;
    highs.push(Number(b.h));
    if (highs.length > LOOKBACK_BARS) highs.splice(0, highs.length - LOOKBACK_BARS);
  }
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Learn what filled on the previous bar before deciding anything.
    // A fill is reported in the batch whose bar it filled at, so the
    // reporting batch's seq is the fill bar's seq.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        fillPrice = Number(fill.price);
        bestClose = fillPrice;
        fillSeq = batch.seq;
      } else if (fill.side === 'sell') {
        fillPrice = null;
        bestClose = null;
        fillSeq = -1;
        lastExitSeq = batch.seq;
      }
    }

    if (state.equity > peakEquity) peakEquity = state.equity;
    if (state.warmingUp) return [];

    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];

    if (held !== undefined && held.qty > 0n) {
      if (fillPrice === null) return []; // fill not reported yet; wait a bar
      if (close > bestClose!) bestClose = close;
      const gainBps = ((close - fillPrice) / fillPrice) * 10_000;
      const trailBps = ((bestClose! - close) / bestClose!) * 10_000;
      const ageBars = batch.seq - fillSeq;
      const drawdownBps = Number(((peakEquity - state.equity) * 10_000n) / peakEquity);
      const stale = ageBars >= MAX_HOLD_BARS;
      const guard = drawdownBps >= EQUITY_GUARD_BPS;
      if (gainBps >= TAKE_PROFIT_BPS || trailBps >= TRAIL_BPS || stale || guard) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      recordHighs(batch);
      return orders;
    }

    // Flat: only a clean breakout, after the cooldown, opens a position.
    // The breakout test uses the highs of the previous 60 bars, recorded
    // on earlier batches; this bar's high is recorded afterwards.
    const top = breakoutHigh();
    recordHighs(batch);
    if (batch.seq - lastExitSeq < COOLDOWN_BARS) return [];
    if (top === null || close < top) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
    return orders;
  },
});
