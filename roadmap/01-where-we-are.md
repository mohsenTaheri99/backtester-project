# Where we are

An inventory of the app as of v0.2.0 (`effec54`), read from the code. The point
is not to praise or criticise it, but to be precise about what any future has
to build on — and what it has to undo.

## Size

| Part | Lines | What |
|---|---|---|
| Backend | ~2,150 | FastAPI, pandas, backtesting.py, the provider client |
| Strategy | ~570 | One strategy (`ict_sweep.py`) plus shared signal helpers |
| Desktop entry | ~280 | `desktop_app.py`: window, backend thread, logging, single instance |
| Frontend | ~3,000 | React 19 + TypeScript + lightweight-charts |
| Docs | ~1,200 | `docs/`, unusually complete for a project this size |
| Tests | **0** | — |

About 6,300 lines of product code. Small enough that any part can be rewritten;
large enough that the design choices below are real commitments.

## What it does today

- Imports 1-minute candles from Twelve Data using **the user's own API key**,
  paced to their plan's credit limit, resumable, with the spans it has fetched
  remembered so a re-download costs nothing.
- Detects and strips the candles a provider invents while a market is closed —
  28% of a 90-day XAU/USD file. Detected from the data, not a calendar, so
  holidays are caught for free.
- Charts them: TradingView-style, infinite scroll-back, drawing tools with
  persistence, trade zones painted as chart primitives.
- Backtests one strategy (ICT multi-timeframe liquidity sweep) on the 1m grid
  with backtesting.py, reporting stats, an equity curve, a trade list, and a
  **rejection funnel** that explains a run which found nothing by naming the
  filter that rejected the most bars.
- Paper-trades forward on live candles by replaying the same engine, so the
  forward test cannot drift from the backtest.
- Ships as a 27 MB Windows setup file; since this week, built and published by
  a tagged GitHub Actions release.

## The engineering worth protecting

**No lookahead, enforced structurally.** Higher-timeframe facts carry an
`available_at` timestamp and are forward-filled onto the 1m index, so a bar at
time T can only see what was public at T. A fractal swing is stamped with the
close of its k-th confirming bar, not its own time. This is the single hardest
thing to get right in a backtester and the single easiest to get wrong
invisibly. It is also, right now, protected by nothing but the author's memory.

**Cache keys that include the data version.** `store.version(symbol)` is part of
the backtest cache key, so an arriving live candle invalidates a cached result
instead of serving a stale one. Small detail, correct instinct.

**Honest failure reporting.** The rejection funnel, the "how many trading days
were actually tested" line, and `docs/strategy.md`'s warning that 20 trades
prove nothing are the opposite of what most retail tools do. This is a
positioning asset, not just a nicety (see [Competitors](02-competitors.md)).

**A schema-driven strategy panel.** `/api/strategies` combines the params
dataclass with a `PARAM_UI` list; the frontend renders controls from `type`,
`group`, `label`, `unit`, `min`/`max`/`step`. Adding a control is a dict entry,
not a React change. This is the hinge the whole AI idea turns on — see
[AI text-to-strategy](06-ai-text-to-strategy.md).

## The load-bearing constraints

These are the design choices every scenario has to either accept or pay to
undo.

| Constraint | Where | Consequence |
|---|---|---|
| **One process, one user** | module-level `store`, `feed`, `forward`, `jobs`, `settings` singletons | Multi-user means re-architecting state ownership, not adding a login |
| **State in CSV + one JSON file** | `%LOCALAPPDATA%\GoldBacktester` | No concurrent writers, no history, no queries; fine on a PC, not on a server |
| **In-memory pandas frames** | `CandleStore._base[symbol]` | Memory is per-symbol-per-process; a server holding 100 users' symbols does not fit this shape |
| **No authentication, no CORS** | binds `127.0.0.1` | Correct for a desktop app and a non-starter for anything else |
| **Strategies compiled into the exe** | `REGISTRY` in `strategies/__init__.py` | A user cannot add a strategy without a new build — the thing the AI idea must change |
| **Three fixed timeframe roles** | `backtest.py` fetches `bias`/`liquidity`/`trigger` | A strategy with a different shape needs a code change; `docs/strategy.md` already flags this |
| **Windows only** | WebView2, NSIS, `taskkill`, `%LOCALAPPDATA%` | macOS/Linux users cannot try it at all |
| **One data provider** | `providers/twelvedata.py` | Provider outage or plan change is a total outage; also the onboarding cliff (below) |
| **Backtests run in the request thread** | sync FastAPI route | One user is fine; concurrency needs a queue |
| **No commissions, no swap** | `backtest.py` models spread + leverage only | Overnight-holding strategies will be optimistic; fine for an intraday strategy, wrong for others |
| **Unsigned binary** | no code signing | SmartScreen warns every first-time user |
| **Zero tests** | — | The no-lookahead guarantee, the resampling, the market-hours cleaner and the R-multiple maths are all unverified on every commit |

## The onboarding cliff

A new user installs the app and finds: no data, no chart, and a requirement to
sign up for a Twelve Data account, find their API key, paste it into Settings,
and wait for a download. Every scenario that involves other people has to solve
this first — with a bundled sample dataset, a CSV import, or a server-side data
path (which has its own licensing problem, see [Desktop to cloud](08-desktop-to-cloud.md)).

## What this means for the rest of these documents

Two facts shape everything that follows.

1. **The engine is the asset; the app is the demo.** The careful part — honest
   accounting, no lookahead, explained rejections — is reusable in any of the
   five scenarios. The single-process Windows shell is not.
2. **Single-user assumptions are everywhere, and they are cheap to keep and
   expensive to remove.** Any scenario that stays on the desktop is months of
   work; any scenario that moves to a server is a rewrite of the state layer.
   That difference, more than the AI question, is what separates the scenarios.
