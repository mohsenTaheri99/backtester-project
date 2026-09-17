# Scenarios

Five futures. Each has what it looks like, what has to be true for it to work,
what it costs, how it makes money if it does, and — the part usually left out —
**when to admit it isn't working.**

Effort is in solo-developer months at a realistic part-time pace, counting only
what is new, not the maintenance that comes with it.

---

## Scenario 1 — A well-kept personal tool

**Shape.** Exactly today's app, maintained. New strategies get added when the
author wants one. Releases happen when there is something to release.

**Has to be true.** Nothing. This is the default and it is already working.

**Cost.** Near zero. A few days a year.

**Revenue.** None.

**Risks.** Only one: bit-rot. Twelve Data changes its API, WebView2 changes a
behaviour, a pandas upgrade shifts a resample edge case — and with no tests,
the failure shows up as wrong numbers rather than a crash.

**Leading indicator to watch.** Whether people other than the author ask for
it. Three unsolicited requests is the signal to look at Scenario 2 or 5.

**Why it matters.** It is the floor. Every other scenario should be entered
knowing that failing back to this one loses nothing.

---

## Scenario 2 — A paid Windows product for retail traders

**Shape.** The same app, sold. Licence key, auto-update, several strategies,
signed installer, a landing page, an onboarding path that doesn't require a
Twelve Data account on day one.

**Has to be true.**
- Retail FX/gold traders will pay for a *backtester* rather than a signal or an
  EA. (Evidence is mixed: the MQL5 market proves they pay for automation that
  promises returns; it does not prove they pay for rigour.)
- A one-person support load stays survivable.

**Cost.** 3-5 months. Code signing certificate (~$100-400/year), licensing
server or offline key scheme, auto-update, 2-3 more strategies, CSV import,
a website, and the support that follows.

**Revenue.** $30-80 one-off, or $10-20/month. A few hundred users is a
realistic ceiling for a single-developer Windows tool without a community.

**Risks.** Piracy (a desktop app with an offline key is trivially cracked);
support load; the Windows-only constraint halving the addressable audience;
competing against free — TradingView and MT5 both backtest at no cost.

**Kill criteria.** Fewer than 10 paying users three months after launch, or a
support load above ~5 hours a week without revenue to match.

---

## Scenario 3 — An open-source engine with a community

**Shape.** The backtest engine, the no-lookahead conventions and the market-hours
cleaner become a library other people build on. The desktop app becomes its
reference UI.

**Has to be true.**
- The engine is genuinely better at something than backtesting.py, vectorbt or
  Backtrader. Today it is: the `available_at` discipline, the rejection funnel,
  and the invented-candle detector are all real contributions. None of them is
  currently packaged as a library.
- The author enjoys review, issues and API-stability obligations, which are the
  actual cost of a community.

**Cost.** 2-4 months to extract, document, test and publish — plus a permanent
tax on every future change.

**Revenue.** None directly. It buys reputation, contributors, and optionally a
paid hosted tier later.

**Risks.** The commonest outcome is not a hostile fork; it is silence. Most
released libraries get no users. Also: once the engine is open, Scenario 4's
differentiation has to come from the product, not the algorithms.

**Kill criteria.** No outside contributor and under ~50 stars after six months
of real promotion means the community isn't there; keep the library for your
own use and stop marketing it.

---

## Scenario 4 — An AI text-to-strategy SaaS

**Shape.** The destination described in the original idea: a user types a
strategy in plain English, the platform generates it, runs it in a sandbox, and
renders a panel fitted to that strategy.

**Has to be true.**
- The rewrite in [Desktop to cloud](08-desktop-to-cloud.md) gets done: per-user
  state, a database, auth, a job queue, billing.
- The sandbox in [Sandboxing](07-sandboxing.md) is real, not aspirational.
- The data licensing problem is solved — serving provider candles to users from
  your own key is usually a contract violation; see
  [Desktop to cloud](08-desktop-to-cloud.md).
- You can win attention against ChartingLens, TradrLab, CoinQuant and
  Horizon.Trade, who are already there (see [Competitors](02-competitors.md)).

**Cost.** 12-18 months at part-time pace, or 6-9 with help. Plus running costs:
compute for sandboxes, data licensing, and LLM spend (~$0.10-0.30 per generated
strategy at Opus 5 prices before caching — see
[AI text-to-strategy](06-ai-text-to-strategy.md)).

**Revenue.** $20-50/month subscriptions, the standard shape for the segment.
Needs hundreds of paying users to be worth the effort, thousands to be a
business.

**Risks.** The biggest is not technical. It is that the product works, and the
strategies it generates lose money, and users blame the platform. Also:
liability (a generated strategy that trades live), LLM cost per free user,
sandbox escape, and — most likely — running out of runway before distribution
exists.

**Kill criteria.** If after three months of a public beta the median user
generates fewer than two strategies and never returns, the idea is not wanted in
this form. Stop before the cloud bill compounds.

---

## Scenario 5 — The prop-firm backtester *(the recommended wedge)*

**Shape.** A narrower product for a specific, identifiable, already-spending
audience: traders taking funded-account challenges. The app gains challenge
rules as first-class concepts — daily loss limit, maximum drawdown, profit
target, minimum trading days, consistency rules — and answers the question those
traders actually have: *would this strategy have passed, and how often?*

That question needs exactly what the engine already produces (per-trade R
multiples, an equity curve, risk-per-trade sizing) plus a Monte Carlo /
trade-shuffle layer to turn one backtest into a pass probability.

**Has to be true.**
- Prop-firm challenge takers are numerous and spend money. They visibly are:
  the MQL5 market has EAs sold specifically for passing challenges, and 2026
  guidance for those EAs is explicitly framed around drawdown ceilings.
- No existing tool does this well. Worth verifying properly — it is the single
  most important fact in this document and it is currently an assumption.

**Cost.** 2-3 months on top of today's app: a rules model, a Monte Carlo
resampler, a pass/fail report, and one page explaining it.

**Revenue.** Same shape as Scenario 2 ($30-80, or a subscription), but with a
sharper pitch, a findable audience (prop-firm Discords, YouTube, Telegram), and
a reason to buy *this week* rather than eventually.

**Risks.** Prop firms change rules constantly; the rules model has to be data,
not code. Some firms may dislike the tool. The niche may be smaller than it
looks from the outside.

**Kill criteria.** If 20 conversations with challenge takers produce no
interest, drop it — the cost of finding out is a week, not a quarter.

---

## Comparison

| | 1 Personal | 2 Paid desktop | 3 Open source | 4 AI SaaS | 5 Prop-firm |
|---|---|---|---|---|---|
| New effort | ~0 | 3-5 mo | 2-4 mo | 12-18 mo | 2-3 mo |
| Running cost | ~0 | low | ~0 | high | low |
| Revenue ceiling | none | low | none | high | low-medium |
| Rewrite needed | no | no | partial | **yes** | no |
| Competition | — | heavy | heavy | **very heavy** | light |
| Reversible | — | yes | mostly no | no | yes |

## The recommendation

**Do Scenario 5, keep Scenario 1 as the floor, and treat Scenario 4 as the
destination rather than the next step.**

The reasoning is sequencing, not ambition. Scenario 4 needs a rewrite, a
sandbox, data licensing and a fight against funded competitors — and it needs
users you don't have yet to tell you what to build. Scenario 5 needs none of
that, reuses the engine as it stands, points at an audience that is already
spending money, and — critically — is *reversible*: if it fails, you are back at
Scenario 1 having lost a quarter.

It also produces the thing Scenario 4 actually requires, which is not
technology but evidence: real users, real feedback, and a reason for them to
trust an AI-generated strategy from you rather than from someone with a bigger
launch.

Layer AI **level 1** (text to parameters, no code generation — see
[AI text-to-strategy](06-ai-text-to-strategy.md)) on top of Scenario 5 early.
It is weeks of work, needs no sandbox, and tests whether users want to talk to
the app at all before anything expensive is built.
