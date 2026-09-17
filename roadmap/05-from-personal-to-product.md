# From personal project to product

The gap between "an app that works" and "an app people want" is not features.
It is the set of things a personal project never has to answer: who is this
for, why would they trust it, how do they find it, and what happens when it
breaks on their machine.

## Who it is for

Three candidate users, in descending order of how reachable they are.

**A. The prop-firm challenge taker.** Has paid $100-500 for a funded-account
challenge and wants to know whether their setup survives the drawdown rules.
Identifiable (Discords, Telegram, YouTube, prop-firm communities), already
spending, and has a question with a deadline. *This is the recommended first
audience — see Scenario 5 in [Scenarios](03-scenarios.md).*

**B. The ICT / smart-money retail trader.** Trades gold and FX intraday on
concepts this app already implements. Large population, reachable through the
same channels, but sceptical of tools and used to free ones.

**C. The semi-technical strategy tinkerer.** Would otherwise use Python. Small
population, low willingness to pay, high support cost — but the source of good
bug reports and the only group that will ever write a strategy by hand.

A personal project can serve all three badly. A product has to pick A, say so
on the front page, and let B and C arrive anyway.

## The wedge

One sentence a stranger understands, with a deadline attached:

> **Find out whether your strategy would have passed the challenge — before you
> pay for another one.**

That is a question today's engine can nearly answer already (it needs the rules
model and the Monte Carlo layer from
[Gaps and next steps](04-gaps-and-next-steps.md)). Compare it to "a backtester
for gold", which invites the reply "TradingView does that for free".

## The four things standing between the app and a stranger

1. **The empty first run.** No data, no chart, and a demand for a Twelve Data
   account. Fix with a bundled sample (a few weeks of 1m gold, a few MB) plus
   CSV import. Nobody should have to sign up for a third-party service to see
   the product work.
2. **SmartScreen.** "Windows protected your PC" on first run, on an unsigned
   binary, from an unknown developer, in a product category full of scams. A
   code-signing certificate (~$100-400/year, OV; EV buys instant reputation at
   a higher price) is the single largest trust purchase available.
3. **No way to hear about updates.** The release workflow now publishes
   versions the app cannot see. An update banner is days of work.
4. **No way for a user to report anything.** No crash reporting, no feedback
   link, no support address. Right now a broken install is silent.

## Distribution

The realistic channels, in order of effort-to-signal:

- **Show it, don't describe it.** A 60-second screen recording of a backtest
  that finds nothing, and the app explaining *why* — that is the memorable
  moment, and no competitor's demo has an equivalent.
- **Prop-firm and ICT communities.** Discord, Telegram, YouTube comments.
  Answer questions with the tool rather than posting the tool.
- **A single written artefact with real numbers.** "We removed 28% of a 90-day
  gold file because the provider invented it, and here is what that did to the
  results." That is a genuinely interesting finding, it is already true, and it
  is the kind of post that gets shared by people who distrust trading tools.
- **MQL5-adjacent audiences.** People buying EAs are people paying to automate
  trading. They are not being offered rigour by anyone.
- **Persian-language channels**, if that is the first market — with the caveats
  under Payment below.

Deliberately not: paid ads (no funnel to feed), a Product Hunt launch (wrong
audience), or an app store (Windows desktop, wrong shape).

## Pricing

| Model | Fits | Notes |
|---|---|---|
| One-off licence, $39-79 | Scenario 2/5 | Matches MQL5 buying habits ($30-3,000 per EA). Simple, no server needed |
| Subscription, $12-20/mo | Anything with ongoing cost | Only honest once there is ongoing value: updated data, new strategies, cloud runs |
| Free tier + paid features | Building an audience first | The free tier must be genuinely useful — charting and one backtest a day |

Start with a one-off licence and a free trial. It needs no billing
infrastructure beyond a payment link and a key generator, and it does not
promise a cadence of updates that a solo developer may not sustain.

**Payment is a real constraint, not a detail.** If the first market is Iran,
international card rails are unavailable; that points to local payment
processors, crypto, or a licence-key model sold through a local channel. It
also shapes pricing: a $79 tool prices differently against local incomes. This
needs a decision before a pricing page exists — it is the one open question in
this document that cannot be researched from the code.

## Trust

This is a product category adjacent to scams. Every trust signal is worth more
than a feature:

- **Sign the binary.** See above.
- **Say what the tool cannot do.** `docs/strategy.md` already says 20 trades
  prove nothing. Put that in the product, not just the docs. A tool that argues
  against over-reading its own output is memorable.
- **Show the data cleaning.** Let the user see the candles that were removed.
- **Never imply profitability.** No backtest result on a landing page without
  the sample size next to it. This is also a legal position (below).
- **Publish the invariant.** Once the lookahead tests exist, saying "here is
  the test that proves this backtester cannot see the future, and here is how
  to run it" is a claim almost nobody in this market can make.

## Support, and what it costs

A solo developer can absorb roughly five hours a week of support. Reduce it
before it arrives: a troubleshooting page, `app.log` attached to a one-click
"report a problem", an FAQ built from the first ten questions, and a public
changelog so nobody has to ask what changed.

Set the expectation on the page: email support, replies within a few days, no
phone, no trading advice. A tool that says "I answer within 3 days" and does is
trusted more than one that promises instant help.

## Legal and liability

- **Not investment advice.** Prominent, in the app and on the site.
- **No performance claims.** Showing a backtest as evidence of future return is
  regulated in many jurisdictions and dishonest in all of them.
- **Data redistribution.** Bundling a sample dataset requires checking the
  provider's terms; serving provider data from a server to users almost
  certainly violates them (see [Desktop to cloud](08-desktop-to-cloud.md)).
- **The moment a live broker connection exists**, the liability profile changes
  completely. That is a reason to delay it, not a reason to hide it.

## How to know it is working

| Signal | Meaning |
|---|---|
| Strangers install it without being asked | The pitch works |
| They return in week two | The product works |
| They ask for a specific feature | They have a real use, not curiosity |
| They tell someone else | The wedge is sharp |
| They pay | Everything above, confirmed |

The first four are free to measure and all of them precede revenue. If the
first two never happen, no amount of AI will fix it — which is the argument for
doing this before building the platform in
[AI text-to-strategy](06-ai-text-to-strategy.md), not after.

## The first concrete step

Find ten people in audience A. Show them the tool. Watch where they get stuck
without helping. That produces a better roadmap than this document can, and it
costs a week.
