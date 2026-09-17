# Gaps and next steps

What is missing, and the order to fix it in. Gaps are grouped by area; the
sequence at the end is the actual answer to "what should I build next".

## The gap inventory

### Correctness and trust

| Gap | Why it matters | Effort |
|---|---|---|
| **No tests at all** | The no-lookahead guarantee, resampling, market-hours cleaning and R-multiple maths are unverified on every commit. This is the product's core claim, protected by nothing | M |
| No commission or swap model | `backtest.py` models spread and leverage only. Any strategy holding overnight is optimistic | S |
| No slippage model | Entries fill exactly at the trigger close. Real 1m gold fills do not | S |
| No out-of-sample split | Nothing stops a user tuning parameters on the whole dataset and believing the result | S |
| No Monte Carlo / trade shuffling | One equity curve is one sample. Users read it as destiny | M |

### Engine and analysis

| Gap | Why it matters | Effort |
|---|---|---|
| **No parameter optimisation** | The first thing every serious user asks for after their first backtest | M |
| No walk-forward analysis | The honest version of optimisation; pairs naturally with the above | M |
| Only one strategy | The registry has never had to generalise. Also: nothing to compare against | M |
| Three hardcoded timeframe roles | `backtest.py` fetches `bias`/`liquidity`/`trigger`; already flagged in `docs/strategy.md`. Blocks any differently-shaped strategy — and every AI-generated one | S |
| One position at a time | No pyramiding, no portfolio, no multi-symbol run | M |
| No saved runs | Every backtest is forgotten when the app closes. No history, no comparison, no "what did I try last week" | M |

### Data

| Gap | Why it matters | Effort |
|---|---|---|
| **No CSV import** | The onboarding cliff: a new user cannot see anything without a Twelve Data account. Import removes that in a day | S |
| One provider | Outage or plan change is a total outage | M |
| No data export | Users cannot take their cleaned candles elsewhere; also blocks trust ("show me what you removed") | S |
| No tick data | 1m OHLC cannot resolve whether stop or target hit first inside a bar. Currently unaddressed and unmentioned in the UI | L |

### Product and UX

| Gap | Why it matters | Effort |
|---|---|---|
| No strategy comparison view | Two runs cannot be seen side by side | M |
| No report export | Nothing to share, screenshot or keep. Traders share results constantly | S |
| No Persian / RTL UI | If the first audience is Persian-speaking, this is not cosmetic | M |
| No prop-firm rules | See Scenario 5 — the wedge | M |

### Distribution and operations

| Gap | Why it matters | Effort |
|---|---|---|
| **No auto-update** | Now that tagged releases exist, the app still cannot tell a user a new one is out | S |
| Unsigned installer | SmartScreen greets every first-time user with a warning | S (money) |
| No crash reporting | `app.log` exists on the user's disk and nowhere else. You will never learn about a crash | S |
| No usage telemetry (opt-in) | No idea which features are used. Every product decision is a guess | M |
| Windows only | macOS and Linux users cannot try it | L |

`S` ≈ days, `M` ≈ a week or two, `L` ≈ a month or more.

## What to build next

### The next three commits

1. **A test suite, starting with the lookahead invariant.**
   The property to test is sharp and mechanical: *run the strategy over bars
   `0..T`, then over bars `0..T+n`, and the signals and context values at bar
   `T` must be identical.* If future bars can change a past decision, the
   invariant is broken and the test says so. Add golden-file tests for
   `build_context`, the market-hours detector and the R-multiple maths.
   This is first because every other feature makes the untested surface larger,
   and because it is the exact machinery the AI work needs later for auditing
   generated strategies (see [AI text-to-strategy](06-ai-text-to-strategy.md)).

2. **CSV import.**
   Kills the onboarding cliff, makes the app demonstrable to anyone, and makes
   the test suite easy to feed with fixed data. A day or two of work with an
   outsized effect on everything that involves showing the app to a person.

3. **Update check against the GitHub releases API.**
   The release workflow just landed; the app should read
   `/repos/:owner/:repo/releases/latest`, compare against `APP_VERSION`, and
   show a quiet banner. No installer machinery, no auto-download — just the
   notice. Cheap, and it closes the loop the release workflow opened.

### Then, in rough order

4. **Out-of-sample split and a Monte Carlo trade shuffle.** Turns one equity
   curve into a distribution and makes the tool honest in a way competitors
   are not. Also the engine half of Scenario 5.
5. **Prop-firm rule model and pass/fail report.** The wedge from
   [Scenarios](03-scenarios.md). Rules as data, not code — they change monthly.
6. **A second strategy.** Pick one structurally different from ICT (a moving
   average crossover would do) purely to force the registry and the timeframe
   roles to generalise. This is a prerequisite for anything AI-generated, and
   it will surface every hidden assumption in `backtest.py`.
7. **Parameter optimisation with walk-forward.** Only after 4 and 6, so the
   optimiser cannot become a machine for producing overfitted results.
8. **AI level 1: text to parameters.** No code generation, no sandbox — see
   [AI text-to-strategy](06-ai-text-to-strategy.md). Weeks, not months, and it
   is the cheapest possible test of whether users want to talk to the app.
9. **Report export and saved run history.** The sharing loop; how other people
   hear about the tool.
10. **Crash reporting and opt-in telemetry.** Before there are enough users for
    silence to be expensive.

### Deliberately not next

- **A live broker connection.** It converts a research tool into something that
  can lose money on its own, with the liability that implies. Not before the
  backtest is trusted.
- **macOS support.** Real work, no evidence of demand yet.
- **The cloud rewrite.** See [Desktop to cloud](08-desktop-to-cloud.md) — right
  destination, wrong moment.
- **AI level 3 (Python code generation).** See
  [AI text-to-strategy](06-ai-text-to-strategy.md). Wrong order; level 2 has to
  exist and be found insufficient first.

## The one-line version

Test the invariant that makes the product true, remove the onboarding cliff,
then build the prop-firm wedge — and let the AI layer start at parameters, not
at code.
