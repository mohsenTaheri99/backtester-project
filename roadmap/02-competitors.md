# Competitors

Checked September 2026 with web search. Prices and claims move fast in this
market — treat every number here as "was true when written" and re-check before
a decision rests on it. Sources are listed at the end.

## The five segments

### 1. Charting platforms with a scripting language

**TradingView** (Pine Script) and **TrendSpider** (from $39/month at entry
level). This is where most retail traders already are. Their backtesting is
convenient and structurally optimistic: bar-magnifier limits, repainting
indicators, and no strong story about lookahead.

*Relevance:* the incumbent habit. Nobody leaves TradingView for a feature; they
leave for an answer TradingView cannot give — like "was this result honest".

### 2. MetaTrader / MQL5

**MT4/MT5** with the built-in Strategy Tester, plus the MQL5 Market: over
10,000 Expert Advisors listed as of mid-2026, priced $30-$3,000. MQL5 now has
OOP, ONNX model integration and multi-threaded optimisation.

*Relevance:* this is the closest audience to the current app — retail FX/metals
traders who already pay for automation. It is also the clearest evidence of
what they will pay ($30-$3,000 for a single EA). And there is a well-documented
complaint with it: *"MQL5 Market backtests are structurally optimistic — one
symbol, one historical window, and parameters tuned until that window looks
perfect."* That complaint is this project's opening.

### 3. Quant / developer platforms

**QuantConnect** (free for research and backtesting; realistically $50-$300/mo
once data and live trading are included), **Backtrader**, **vectorbt**,
**backtesting.py** (what this app already uses), **Freqtrade** (crypto).

*Relevance:* this is the ceiling on the engine's technical differentiation.
Nothing here can out-feature QuantConnect. But all of them require code, and
none of them ship a chart a discretionary trader would recognise.

### 4. No-code automation

**Composer** (now SoFi-owned; visual no-code algorithmic trading, $20B in
volume claimed), **Capitalise.ai** (rule execution free through partner
brokers), **Coinrule**, **3Commas**.

*Relevance:* they prove the demand for "trade automation without code" and they
own the US-equities and crypto ends of it. They are weak on FX/metals intraday,
weak on backtest rigour, and mostly tied to their own broker integrations.

### 5. The AI-native wave (2025-2026)

This is the crowded part, and it is new:

| Platform | Pitch |
|---|---|
| **ChartingLens** | Type a strategy in plain English, get a full backtest with trades plotted on the chart |
| **TradrLab** | Describe a setup in plain English; build, test, analyse |
| **CoinQuant** | Natural-language strategy builder, converts to executable logic, backtests on Kaiko data |
| **Horizon.Trade** | "Agentic" — plain English to backtest to broker to live, one click |

*Relevance:* **the idea in [AI text-to-strategy](06-ai-text-to-strategy.md) is
no longer novel.** One 2026 roundup puts it plainly: the category has matured
enough that you no longer need to learn a programming language to test a
strategy. Building "an AI backtester" in 2026 is entering a race already in
progress, mostly against funded teams.

## Where that leaves this project

**What it does not have:** a live broker connection, multi-asset coverage, an
optimiser, a community, a brand, a mac build, or a second strategy.

**What it does have that the AI-native wave mostly does not:**

1. **A provable no-lookahead discipline.** Every competitor in segment 5 is
   generating code or logic from text and running it. Almost none of them can
   tell you whether what they generated peeked at the future. This project's
   `available_at` design is exactly the machinery needed to *check* that — see
   the lookahead audit in [AI text-to-strategy](06-ai-text-to-strategy.md). In a
   market where the standing complaint is "these backtests are too good to be
   true", being the one that can prove otherwise is a real position.
2. **Data hygiene nobody advertises.** Removing 28% invented weekend candles
   from an FX file changes results materially. Competitors inherit whatever
   their data vendor emits.
3. **A rejection funnel.** "Your strategy made no trades because the session
   filter rejected 71% of bars" is a better product experience than an empty
   table, and it is the natural UI for an AI-generated strategy that does
   nothing.
4. **Local-first privacy.** The strategy never leaves the PC; the user brings
   their own data key. For traders who believe their edge is worth protecting —
   a real belief in this audience, whether or not it is justified — this is a
   feature every SaaS competitor structurally cannot offer.
5. **FX/metals intraday focus.** Segment 5 skews US equities and crypto.
   Gold, 1-minute, session-aware, prop-firm-shaped is underserved.

## The competitive read

Head-on, "AI builds your strategy" is a bad fight: four or more funded
platforms, all further along, all with distribution. The defensible framing is
narrower and harder to copy:

> **The backtester that refuses to lie to you** — for gold and FX intraday
> traders, with prop-firm rules built in, and an AI assistant that writes the
> strategy *and then proves the result is honest.*

That is a position built on what the codebase already does well, not on what
would have to be invented. It also implies the sequencing argued in
[Scenarios](03-scenarios.md): earn the audience with rigour first, add the AI
layer second.

## Open questions worth real research

- What do Persian-speaking retail traders actually use, and what will they pay
  in a market where international payment rails are hard? (Not answerable from
  English-language search; it changes the pricing model in
  [From personal project to product](05-from-personal-to-product.md).)
- How many prop-firm challenge takers are there, and do any existing tools
  model challenge rules properly? This is the wedge in Scenario 5 and it is
  worth an afternoon of checking before betting on it.
- What do the AI-native platforms charge, and what is their churn? Pricing was
  not consistently published at the time of writing.

## Sources

- [Best AI Trading Platforms in 2026 — LiquidityFinder](https://liquidityfinder.com/post/best-ai-trading-platforms-in-2026-top-tools-for-strategy-building-backtesting-and-automation-fbXieI)
- [Best No-Code Backtesting Tools in 2026 — Will Kopec](https://willkopec.com/blog/best-no-code-backtesting-tools)
- [Best AI Agent Backtesting Software 2026 — CoinQuant](https://www.coinquant.ai/compare/the-best-ai-agent-backtesting-software-for-automating-trading-strategies-in-2026)
- [TradrLab](https://tradrlab.com/)
- [10 Best AI Trading Platforms in 2026 — ChartingLens](https://chartinglens.com/blog/best-ai-trading-platforms-2026)
- [QuantConnect vs. Composer — Composer](https://www.composer.trade/learn/quantconnect-vs-composer-which-is-the-better-platform-to-create-a-stock-trading-bot)
- [Best Capitalise.ai Alternatives in 2026 — Obside](https://obside.com/trading-guides/best-capitalise-ai-alternatives)
- [Expert Advisors for MetaTrader 5 — MQL5 Market](https://www.mql5.com/en/market/mt5)
- [Most MT5 Expert Advisors Are Built to Pass a Backtest, Not to Trade Live](https://www.fivetecglobalcapital.com/blogs/mt5-expert-advisors-explained)
- [Best MT5 Expert Advisors for Funded Accounts — For Traders](https://fortraders.com/blog/best-mt5-expert-advisors-eas-for-funded-accounts)
