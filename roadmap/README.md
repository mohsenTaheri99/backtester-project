# Roadmap

Strategy notes for Gold Backtester: where it stands, what it could become, and
what the AI text-to-strategy idea would actually take.

**These documents live on the `claude/roadmap` branch and are deliberately not
merged into `main`.** `main` describes the app as it is; this folder is about
what it is not yet. Keeping them apart means no reader mistakes a plan for a
feature.

Written 2026-09-17 against commit `effec54` (v0.2.0). Everything about the
current code was read from the code, not assumed; everything about the market
is dated and sourced, and should be re-checked before a decision rests on it.

## The documents

| # | Document | Answers |
|---|---|---|
| 1 | [Where we are](01-where-we-are.md) | What exists today, and which parts of it constrain every future |
| 2 | [Competitors](02-competitors.md) | Who else does this, what they charge, where the gap is |
| 3 | [Scenarios](03-scenarios.md) | Five futures, with what each demands and when to abandon it |
| 4 | [Gaps and next steps](04-gaps-and-next-steps.md) | What is missing, in the order it should be built |
| 5 | [From personal project to product](05-from-personal-to-product.md) | Users, wedge, distribution, pricing, trust, support |
| 6 | [AI text-to-strategy](06-ai-text-to-strategy.md) | Is the core idea feasible, and how would it be built |
| 7 | [Sandboxing](07-sandboxing.md) | How to run generated code without handing over the server |
| 8 | [Desktop to cloud](08-desktop-to-cloud.md) | What in this codebase breaks when there is more than one user |

## The short version

**Where we are.** About 6,300 lines: a single-process Windows desktop app, one
strategy, one data provider, one user, no tests. The engineering is careful in
the place it matters most — the no-lookahead discipline — and that care is the
asset everything else should be built on.

**Competitors.** The AI-strategy-from-plain-English space got crowded in
2025-2026: ChartingLens, TradrLab, CoinQuant, Horizon.Trade, plus Composer and
Capitalise.ai from the no-code side. Being "an AI backtester" is no longer a
position. Being the one that proves its backtests are honest still is.

**Feasibility of text-to-strategy.** Yes — and this codebase is better placed
than most, because the strategy panel is already generated from a schema
(`param_ui`) and the strategy contract is already written down. The right path
is three levels: text to parameters (weeks), text to a constrained spec the
engine interprets (months), text to Python in a sandbox (a project of its own).
Skipping to level 3 first is the common way this idea dies.

**Sandboxing.** Untrusted Python cannot be contained inside the same process —
that is settled, not a matter of effort. The staged answer: don't generate code
at all at levels 1-2, and when you do, run it in a microVM or gVisor with no
network, a read-only filesystem, and a hard wall-clock limit.

**The honest recommendation.** The cheapest path to "people actually want this"
is not the AI platform. It is a prop-firm-aware backtester (challenge rules,
drawdown ceilings, consistency checks) for the audience already buying MT5
Expert Advisors, with AI level 1 as the on-ramp. Scenario 5 in
[Scenarios](03-scenarios.md) makes that case. The AI platform stays the
destination; it should not be the first move.

**The single highest-value next commit** is not a feature: it is a test suite
around the no-lookahead invariant. Every claim this product makes rests on it,
and nothing currently protects it.

## Reading order

For a decision: 1 → 3 → 5. For the AI idea: 6 → 7 → 8. For the next sprint: 4.

## Keeping these current

Re-check the dated market claims in [Competitors](02-competitors.md) before
acting on them; that section ages fastest. When the code changes enough that
[Where we are](01-where-we-are.md) is wrong, these documents stop being useful —
update it or delete them.

These documents are written in English to match `docs/` and the rest of the
repository. If Persian would serve better, they can be translated.
