# Desktop to cloud

What specifically breaks in *this* codebase when there is more than one user.
This is the hidden cost under Scenario 4 in [Scenarios](03-scenarios.md), and it
is larger than the AI work it exists to support.

## The shape of the problem

The app is not "a backend with a desktop client". It is one process where the
backend *is* the desktop app: module-level singletons hold the state, the CSVs
are the database, and `127.0.0.1` is the security model. None of that is wrong —
it is the right design for what it is. It is simply not a design that scales by
adding users.

## What has to change, module by module

| Today | Why it breaks | What replaces it |
|---|---|---|
| `store = CandleStore()` — a module singleton holding every symbol's 1m frame in memory | One process cannot hold N users' datasets; two requests mutate shared state | Per-request data access against shared storage; candles in Parquet on object storage, cached by an LRU with a memory budget |
| CSVs in `%LOCALAPPDATA%` | No concurrency, no queries, no per-user isolation | Object storage for candles; Postgres for metadata, symbol catalogues and fetch coverage |
| `settings.json` holds settings *and* the symbol catalogue *and* the forward session | Per-user rows, concurrent writes, migrations | Postgres tables with a real schema and versioned migrations |
| `feed = LiveFeed()` — one poller for one followed symbol | Every user wants their own symbol live | One shared poller per *symbol* (not per user), fanned out to subscribers. Cheaper than today, not more expensive |
| `forward = ForwardTester()` — a single session | One session per user, persisted | A sessions table plus a worker that advances them |
| `jobs = JobRunner()` — one download at a time | Serialising downloads across all users is unusable | A per-user queue, and shared symbol data fetched once for everyone |
| In-process backtest cache (16 entries) | Wrong scope, lost on restart, unshared | Redis or a table, keyed as it is now — the key design (including `store.version`) is already correct |
| Sync FastAPI route runs the backtest inline | A 10-second run blocks a worker; concurrency collapses | A job queue with workers, results polled or streamed |
| No auth, no CORS | The security model was "it's localhost" | Sessions, per-user authorization on every route, CSRF/CORS policy, rate limits |
| Strategies compiled into the binary | Users need their own | Per-user strategy rows, versioned — and, at level 3, [Sandboxing](07-sandboxing.md) |

Roughly: `main.py`, `store.py`, `settings.py`, `jobs.py`, `live.py` and
`forward.py` all change substantially. What survives nearly untouched is the
valuable part — `backtest.py`, `strategies/`, `market_hours.py`, `signals.py`
and the frontend. That is a good ratio, and it is the strongest argument that
the engine is the asset.

## The problem that is not code

**Data licensing.** Today every user brings their own Twelve Data key and the
data lands on their own PC. That is squarely within normal terms. The moment a
server holds candles fetched with *your* key and serves them to users, it is
redistribution, which market-data agreements generally prohibit and price
separately — often at a level that dwarfs the compute bill.

Three ways out, none free:

1. **Users keep bringing their own key**, and the server fetches on their behalf
   with their credential. Preserves the licence position; complicates onboarding
   and key storage (now you are holding other people's API keys, with the duty
   of care that implies).
2. **Buy a redistribution licence.** Clean, and priced accordingly.
3. **Users upload their own data.** Sidesteps licensing entirely; works for
   traders who already have broker exports; makes the product harder to start
   with.

This decision gates the business model, not just the architecture, and it should
be made before any rewrite begins.

## Other things that arrive with a server

- **Cost per user.** Every backtest is CPU on your bill, not theirs. A free tier
  needs quotas from day one.
- **Billing and subscription management** — plus refunds, failed payments and
  taxes, which no roadmap remembers to budget for.
- **Uptime.** The desktop app fails for one user at a time. A server fails for
  everyone, at night, on a holiday.
- **Backups and data loss.** Users' strategies become your responsibility.
- **Compliance.** Personal data, retention, deletion requests.
- **Support at scale**, which is a different job from support for ten people.

## The hybrid worth considering first

There is a middle path that keeps almost all of the value and almost none of the
rewrite:

> **The desktop app stays exactly as it is. A small cloud service does only the
> things the desktop cannot: generate strategies from text, and validate them.**

The flow: the app sends the user's description (and the strategy contract) to a
service; the service calls the model, runs the validation gauntlet in its own
sandbox against a *fixture* dataset, and returns a spec or a validated module.
The user's candles never leave their PC. The real backtest runs locally, as
today.

What this buys:

- No data licensing problem — the service never touches market data beyond a
  fixture you own.
- No multi-tenant state rewrite — the service is stateless.
- A much smaller sandbox: one workload, fixed dataset, no user data in it.
- The AI feature ships without the cloud rewrite, and the desktop privacy story
  — a real differentiator (see [Competitors](02-competitors.md)) — survives.

What it does not buy: strategy sharing, a web version, mobile, or anything that
needs users to see each other's work. Those are the reasons to eventually do the
full rewrite — and they are product reasons, which is the right way to arrive at
an architecture.

## If the full rewrite happens anyway

Sequence that limits the damage:

1. **Extract the engine as a library first** — `backtest.py`, `strategies/`,
   `signals.py`, `market_hours.py` with no filesystem or singleton dependencies.
   This is useful in every scenario, including staying on the desktop, and it is
   the piece both the desktop app and the service would import. (It is also
   Scenario 3 in [Scenarios](03-scenarios.md), for free.)
2. **Move state behind interfaces** — `CandleStore` and `settings` gain an
   implementation boundary, with the CSV/JSON versions kept as the desktop
   implementation. Nothing breaks; the seam appears.
3. **Add the database and the job queue** behind those interfaces.
4. **Add auth and per-user scoping** — every route, not most of them.
5. **Then** the web UI, which is mostly the existing frontend with a different
   API client.

Steps 1 and 2 are worth doing regardless: they are the difference between a
rewrite and a migration, and they pay for themselves the first time the engine
needs to run anywhere but inside this one process.
