# AI text-to-strategy

The idea, stated precisely:

> A user describes a strategy in their own words. The system produces the
> strategy, runs it, and shows a control panel fitted to *that* strategy rather
> than a generic form. Generated code runs somewhere it cannot hurt the server.

This document answers whether that is feasible, what it would actually take,
and in what order. Sandboxing gets its own document —
[Sandboxing](07-sandboxing.md) — because it is the part most likely to be
underestimated.

## Verdict

**Feasible, and this codebase is unusually well placed for it — provided it is
built in three levels and not in one jump.**

The reason for optimism is not the language model. It is that three of the
hardest pieces already exist here:

| Piece | Where it already is | Why it matters |
|---|---|---|
| **A schema-driven panel** | `PARAM_UI` → `/api/strategies` → `BacktestPanel.tsx` renders `bool`/`int`/`float`/`select` controls grouped by `group` | The "panel fitted to the strategy" is not a feature to build. It already works — the generator just has to emit the schema |
| **A written strategy contract** | `docs/strategy.md` § "Adding a strategy" | An LLM needs a target shape. This repo has one, in prose, already precise enough to be a prompt |
| **A lookahead discipline that can be tested** | `available_at` + `reindex(method="ffill")` | The way to *audit* a generated strategy for cheating. Almost no competitor can do this — see [Competitors](02-competitors.md) |

The reason for caution: generating Python and executing it is the most
expensive, most dangerous, and least necessary version of this idea. Most of
what users ask for does not need it.

## Three levels

### Level 1 — Text to parameters

**What it is.** The user types "be more conservative, only London session, wider
stops". The model maps that onto the existing strategy's parameters and returns
a params object. Nothing is generated but JSON; the code that runs is the code
you shipped.

**How.** One API call with structured outputs, given the strategy's parameter
schema (which `/api/strategies` already produces) and the user's text. The
result is validated against the same dataclass the API already validates
against, then applied to the form. The user sees the sliders move and can undo.

**Cost.** Small: a few thousand tokens per request.

**Risk.** Essentially none. No code execution, no sandbox, no new attack
surface. The worst case is wrong parameters, which the user can see and change.

**Effort.** 2-3 weeks including UI.

**Why do it first.** It answers the only question that matters before anything
expensive is built: *do users want to talk to this app at all?* If they type one
request and never again, levels 2 and 3 are moot and you found out for the price
of a sprint.

### Level 2 — Text to a strategy spec *(the sweet spot)*

**What it is.** The model emits a **declarative spec** — JSON, validated against
a schema — which the backend *interprets*. No Python is generated and no
arbitrary code runs, so there is no sandbox problem at all.

A first-cut shape, drawn from what `ict_sweep.py` actually needs:

```jsonc
{
  "name": "London sweep reversal",
  "timeframes": { "bias": "1h", "liquidity": "15m", "trigger": "5m" },
  "indicators": [
    { "id": "atr14",  "fn": "atr",     "tf": "trigger", "period": 14 },
    { "id": "swings", "fn": "fractal", "tf": "bias",    "k": 5, "by": "close" }
  ],
  "bias":    { "when": "close > swings.last_high", "then": "long" },
  "setup":   { "when": "sweep(liquidity, lookback=40)", "window_min": 30 },
  "trigger": { "when": "pin_bar(ratio=2.0) or engulfing()" },
  "filters": [ { "session": ["london", "new_york"], "minutes": 150 },
               { "premium_discount": true } ],
  "risk":    { "per_trade_pct": 1.0, "reward": 2.0,
               "stop": "swept_extreme + 0.5*atr14", "breakeven_at_r": 1.0 },
  "params":  [ { "name": "reward", "label": "Reward ratio", "group": "Risk",
                 "unit": "R", "min": 0.5, "max": 10, "step": 0.5 } ]
}
```

Everything an expression can reference is a function *you* implemented. The
evaluator has no `eval`, no imports, no filesystem — it walks a whitelisted
expression tree over pandas Series that were built with `available_at`
timestamps, exactly as `build_context()` does now. **Lookahead becomes
impossible by construction rather than by review**, which is a much stronger
guarantee than anything level 3 can offer.

The `params` block is the generated panel: it is the same shape as `PARAM_UI`,
so the existing frontend renders it with no changes.

**Coverage.** A vocabulary of perhaps 30-40 primitives — moving averages, ATR,
RSI, fractals, sweeps, engulfing/pin patterns, sessions, ranges, breakouts,
crossovers, time filters, risk models — covers the large majority of what retail
traders describe in words. The tail that it cannot express is real, and that is
what level 3 is for.

**Effort.** 2-4 months: the schema, the evaluator, the indicator library, the
generator prompt, and the validation gauntlet below.

**Risk.** Moderate and contained. The failure mode is "the spec cannot express
what I meant", not "the server was compromised".

### Level 3 — Text to Python

**What it is.** The original idea in full: the model writes a module
implementing the strategy contract, it is registered per user, and it runs in a
sandbox.

**When it is justified.** Only once level 2 exists and users are visibly hitting
its ceiling — with evidence, i.e. logged "could not express" cases. Building it
first means paying for a sandbox, a code-review pipeline and an isolation
budget in order to serve requests that a 40-function vocabulary would have
handled.

**What it requires** (all of it, not some of it):

1. A hard contract: the module exposes `PARAMS`, `PARAM_UI`, `build_context()`
   and a `Strategy` subclass — the shape `docs/strategy.md` already describes.
2. Static analysis before execution: parse to AST and reject imports outside an
   allowlist, attribute access into dunders, `eval`/`exec`/`compile`/`open`,
   and anything touching the network or filesystem. **This is a filter, not a
   sandbox** — Python's introspection makes in-process containment impossible.
   See [Sandboxing](07-sandboxing.md).
3. Real isolation: a microVM or gVisor, no network, read-only filesystem, hard
   memory and wall-clock caps.
4. The validation gauntlet below, especially the lookahead audit.

**Effort.** 4-6 months on top of level 2, plus ongoing infrastructure cost.

## The generated panel

This is the part that sounds hard and is nearly free.

`/api/strategies` today returns, per strategy, a `params` array where each entry
carries `name`, `label`, `group`, `unit`, `type`, `default` and `min`/`max`/`step`
or `options`. `BacktestPanel.tsx` groups by `group` and renders a control per
`type`. Nothing in the frontend knows anything about ICT.

So: **a generated strategy that emits its own `PARAM_UI` gets a fitted panel
with zero frontend work.** The generator should be asked to expose 4-8 controls —
the ones a user of *that* strategy would actually turn — with sensible ranges,
not every field in the dataclass.

Two smaller pieces make the generated experience match the hand-written one:

- **Rejection labels.** The funnel is what explains a strategy that trades
  nothing, and generated strategies will trade nothing often. The spec (level 2)
  or contract (level 3) should require each filter to carry a human-readable
  rejection label, so "no trades" still comes with a reason.
- **A description.** One or two sentences, generated alongside, shown at the top
  of the panel so a user returning next week knows what they built.

## The validation gauntlet

No generated strategy should reach a user's screen without passing all of these,
in order. Each stage is cheap relative to the one after it.

| # | Stage | Rejects |
|---|---|---|
| 1 | **Schema / parse** | Malformed spec (L2) or unparseable module (L3) |
| 2 | **Static analysis** | Disallowed imports, IO, dynamic execution (L3 only) |
| 3 | **Smoke run** on a fixed fixture | Crashes, infinite loops, non-terminating logic |
| 4 | **Determinism** — run twice, compare | Hidden randomness, wall-clock or ordering dependence |
| 5 | **Lookahead audit** | Strategies that peek at the future |
| 6 | **Resource limits** | Runs exceeding memory or wall-clock caps |
| 7 | **Sanity report** | 0 trades, or 100% win rate — surfaced to the user, not hidden |

### The lookahead audit, in detail

This is the most valuable piece of the entire plan, and the repo is already
built for it.

**The property:** a decision made at bar `T` must not change when bars after `T`
exist or do not.

**The test:** run the strategy over bars `0..T`, record the signals and context
values at `T`. Run it again over `0..T+n`. The values at `T` must be byte-identical.
Repeat at randomly sampled `T`s across the dataset. Any difference is a lookahead
bug — in the generated strategy, or in a helper it used.

It is mechanical, cheap, needs no human review, and it catches the failure mode
that every competitor in this space has and cannot detect. It is also the exact
same test that should be protecting the hand-written strategy today (see
[Gaps and next steps](04-gaps-and-next-steps.md), step 1) — which means the work
is shared, and the AI feature inherits it rather than funding it.

**This is the marketing asset too.** "Every AI-generated strategy is
automatically audited for lookahead bias, and here is the test" is a claim with
teeth in a market whose standing complaint is that backtests are too good to be
true.

## Model, prompt and cost

Generation is a code-generation task with a strict output shape, so:

- **Model:** `claude-opus-5` ($5 / $25 per million input / output tokens, 1M
  context) for generation. `claude-sonnet-5` ($2 / $10) is the sensible
  cost-down for level 1 parameter mapping, where the task is small and the
  schema does the constraining. Do not downgrade the level 3 generator to save
  cents — a wrong strategy costs more than a token.
- **Structured outputs** (`output_config.format`) for level 1 and level 2: the
  model returns JSON already validated against the spec schema, which removes an
  entire class of parse-and-repair code.
- **Adaptive thinking** for level 2/3 generation; the task is genuinely
  multi-step reasoning about market logic.
- **Prompt caching** for the fixed prefix — the contract, the indicator
  vocabulary, the worked examples. That prefix is most of the input on every
  request and it never changes, so caching it is the single biggest cost lever.
  Put the user's text *after* the last cache breakpoint.
- **Batch API** (50% discount) for anything not interactive — re-validating a
  library of generated strategies after an engine change, for instance.

**Rough per-generation cost** at level 2/3: perhaps 15-25k input tokens (the
contract, vocabulary and examples) and 3-6k output, so on the order of
$0.15-0.30 uncached, and materially less once the prefix is cached. Level 1 is
a few cents. The cost that actually hurts is not per call — it is free users
generating dozens of strategies, which is a product decision (a quota) rather
than an engineering one.

**The prompt is the product.** The generator prompt should carry: the contract,
the full indicator vocabulary with signatures, two or three worked examples
(ICT sweep is one, already written), the no-lookahead rule stated as a hard
constraint with the reason, and an instruction to refuse rather than invent when
the request needs a primitive that does not exist. That refusal path matters:
a model that says "I cannot express 'when the VIX spikes' — there is no VIX
feed" is more useful than one that silently approximates it, and each refusal is
a logged, prioritisable feature request.

## Failure modes

| Failure | Why it happens | Mitigation |
|---|---|---|
| **Silent lookahead** | The model writes `df.shift(-1)` or reads a completed higher-TF bar too early | The audit above. Non-negotiable |
| **Overfitting on request** | "Make it profitable" — the model tunes to the sample | Force an out-of-sample split into every generated result; show both |
| **Hallucinated primitives** | The model invents an indicator that does not exist | Schema validation (L2); static allowlist (L3); explicit refusal instruction |
| **Non-determinism** | Randomness, dict ordering, wall-clock | Stage 4 of the gauntlet |
| **Prompt injection via strategy text** | The "strategy description" is user input flowing into a code generator | Treat generated code as hostile regardless of what the prompt said; the sandbox is the boundary, not the prompt |
| **Users blaming the tool for losses** | The strategy came from *your* AI | Never present a generated strategy as an idea worth trading; show sample size, out-of-sample result and the funnel next to every number |
| **Cost per free user** | Generation is not free | Quotas, cheaper model at level 1, cached prefix |
| **"It works but nobody uses it"** | The most likely failure of all | Level 1 first, as the cheap test |

## What to build, in order

1. **The lookahead test suite** (needed anyway — see
   [Gaps and next steps](04-gaps-and-next-steps.md)). Without it, nothing
   generated can be trusted, so it is stage zero rather than a later stage.
2. **A second hand-written strategy**, to force `REGISTRY` and the three
   hardcoded timeframe roles in `backtest.py` to generalise. Every AI-generated
   strategy will hit that wall; better to hit it once, deliberately, with code
   you wrote.
3. **Level 1**: text → parameters. Ship it. Measure whether anyone uses it
   twice.
4. **The spec schema and evaluator** (level 2) — the biggest single piece of
   work, and the one that makes the feature safe by construction.
5. **Level 2 generation** behind the gauntlet, with the generated panel.
6. **Level 3** only if the logged "could not express" cases justify it — and
   only with [Sandboxing](07-sandboxing.md) actually built, not planned.

## The honest caveat

Everything above is about whether it *can* be built. Whether it should be built
is a different question, answered in [Competitors](02-competitors.md): several
funded platforms already sell plain-English strategy generation, so the feature
alone is not a position. What is defensible is the pairing — generation plus a
provable honesty guarantee — and that pairing is only credible from a tool that
has already earned a reputation for rigour. Which is the argument for doing
[Scenarios](03-scenarios.md) Scenario 5 first, and arriving at this feature with
users who already believe you.
