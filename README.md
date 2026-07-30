# Gridiron Desk

Natural-language NFL betting & stats research — an Action Network–style desk for football.
Ask questions in plain English and get answers from play-by-play–derived advanced data, weekly
game logs, situational splits, and live sportsbook lines.

> **Research tool, not betting advice.** Verify every line with your book before wagering.

---

## What it can answer today

| You ask… | It uses… |
|---|---|
| "How many games did Josh Allen throw for 300+ yards?" | Weekly game logs (nflverse), threshold scan |
| "What's CeeDee Lamb's target share and air yards?" | nflverse advanced usage — the prop-driving signals |
| "Christian McCaffrey's last 5 games" | Weekly game log |
| "Justin Jefferson advanced stats" | EPA, target share, air-yards share, WOPR, aDOT, catch rate |
| "Tyreek Hill vs the Jets matchup" | Player usage/efficiency **+ the opponent defense summary** |
| "NFL spreads and totals this week" | Live lines across DraftKings, FanDuel, BetMGM, Caesars… |

The betting-relevant edge lives in **advanced usage** — target share, air-yards share, and WOPR
predict receiving props far better than raw yardage, and the **matchup** view pairs that usage with
the defense a player is about to face.

---

## How it works

```
English question
   │
   ▼
[ Claude (structured outputs) ]   ← server/llm.js: NL → validated query plan
   │  { intent, player, opponent, stat, phase, timeframe, … }
   ▼
[ router ]                        ← server/routes/ask.js: plan → the right source(s)
   │
   ├── nflverse  (server/sources/nflverse.js)  weekly logs, EPA, target share, air yards, WOPR
   ├── ESPN      (server/sources/espn.js)      situational splits, team defense
   └── Odds API  (server/sources/odds.js)      NFL lines & player props across books
   │
   ▼
[ web UI ]                        ← web/: one search box, a renderer per result type
```

**nflverse** (github.com/nflverse/nflverse-data) is the NFL analog of Statcast — weekly player
stats derived from every play, published as CSV on GitHub. It's the reliable, rich core here (clean
typed columns), so game logs, counts, and advanced usage all come from it. ESPN adds situational
splits and opponent-defense context; The Odds API adds the lines.

The LLM turning English into a typed plan is what makes it "ask anything" — new phrasings work
without new code, as long as the *intent* maps to a handler.

---

## Setup

```bash
npm install
cp .env.example .env      # then fill in your keys
npm start                 # → http://localhost:8787
```

**Keys** (both optional — the app runs and tells you what's disabled without them):

- `ANTHROPIC_API_KEY` — the question parser. <https://console.anthropic.com/>.
  Model defaults to `claude-opus-5`; set `GRIDIRON_MODEL=claude-sonnet-5` for a cheaper option.
- `ODDS_API_KEY` — betting lines & props. Free tier ~500 req/month at <https://the-odds-api.com/>.

nflverse (GitHub) and ESPN need no key.

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/ask` `{question}` | Parse + answer. Returns `{plan, result}` (`result.kind` drives rendering). |
| `GET /api/odds` | NFL game lines across books. |
| `GET /api/odds/:eventId/props` | Player props (pass/rush/rec yards, receptions, anytime TD) for a game. |
| `GET /api/advanced/:name?year=YYYY` | A player's advanced usage & efficiency. |
| `GET /api/gamelog/:name?year=YYYY` | Weekly game log. |
| `GET /api/health` | Which keys are configured. |

---

## Roadmap to rival Action

This is a working foundation. To close the gap:

1. **Ingest nflverse play-by-play into a database.** Right now season CSVs are fetched and cached in
   memory. A nightly ingest of full PBP into Postgres unlocks any aggregation instantly and lets the
   LLM write SQL for questions no endpoint anticipates (text-to-SQL) — e.g. "fantasy points allowed to
   slot receivers by Cover-3 defenses".
2. **Real defense-vs-position tables.** Aggregate PBP by opponent + position for true matchup grades
   (yards/TDs allowed to WR1s, RBs on the ground, TEs), not just ESPN's team totals.
3. **Expand markets & props** — alt lines, first-half, anytime/first TD, live odds movement + history,
   and implied-probability vs. your own projection to surface edges.
4. **Next Gen Stats** — separation, cushion, time-to-throw, rush yards over expected (nflverse `nextgen`
   releases) for even sharper matchup reads.
5. **Notes on data:** nflverse renames release assets occasionally (the loader tries current + legacy
   names); ESPN's unofficial endpoints shift shape now and then. Ingesting (step 1) removes both risks.
