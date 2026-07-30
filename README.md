# Diamond Desk

Natural-language MLB betting & stats research — an Action Network–style desk for baseball.
Ask questions in plain English and get answers from official game logs, Statcast pitch-level
data, and live sportsbook lines.

> **Research tool, not betting advice.** Verify every line with your book before wagering.

---

## What it can answer today

| You ask… | It uses… |
|---|---|
| "How many times has Aaron Judge hit 2 HR in a game?" | MLB game logs (regular season + postseason) |
| "Freddie Freeman vs left-handed pitching in 2024" | Situational splits (vs LHP / RHP) |
| "How does Mookie Betts hit against sliders?" | Statcast: batter performance by pitch type (AVG, whiff%, xwOBA, hard-hit%) |
| "Show me Gerrit Cole's pitch mix" | Statcast: pitcher arsenal (usage, velo, whiff rate) |
| "Aaron Judge vs Tarik Skubal matchup" | Batter platoon splits + pitch profile **overlaid on the pitcher's actual arsenal** |
| "Shohei Ohtani's last 10 games" | Recent game-by-game log |
| "MLB moneyline odds today" | Live lines across DraftKings, FanDuel, BetMGM, Caesars… |

The **"last 10 vs LHP/RHP, vs every pitch type against the pitcher's mix"** flow you described is the
`matchup` intent — it's the money view.

---

## How it works

```
English question
   │
   ▼
[ Claude (structured outputs) ]   ← server/llm.js: NL → validated query plan
   │  { intent, player, pitcher, stat, handedness, timeframe, … }
   ▼
[ router ]                        ← server/routes/ask.js: plan → the right source(s)
   │
   ├── MLB Stats API   (server/sources/statsapi.js)  game logs, L/R splits, last-N, postseason
   ├── Baseball Savant (server/sources/savant.js)    pitch mix, batter-vs-pitch-type (Statcast)
   └── The Odds API    (server/sources/odds.js)      lines & props across major books
   │
   ▼
[ web UI ]                        ← web/: one search box, a renderer per result type
```

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

- `ANTHROPIC_API_KEY` — the question parser. Get one at <https://console.anthropic.com/>.
  Model defaults to `claude-opus-5`; set `DIAMOND_MODEL=claude-sonnet-5` for a cheaper option.
- `ODDS_API_KEY` — betting lines. Free tier ~500 req/month at <https://the-odds-api.com/>.

MLB Stats API and Baseball Savant need no key.

### Also here: `mlb-stats-search.html`

A zero-dependency, keyless demo — a single HTML file that answers game-log threshold questions
directly from the MLB API in the browser. Good for a quick look; the full app above is the real thing.

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/ask` `{question}` | Parse + answer. Returns `{plan, result}` (`result.kind` drives rendering). |
| `GET /api/odds` | Game lines across books. |
| `GET /api/odds/:eventId/props` | Player props (HR, hits, total bases, strikeouts…) for a game. |
| `GET /api/pitch-mix/:name?year=YYYY` | A pitcher's arsenal. |
| `GET /api/pitch-profile/:name?year=YYYY` | A batter's performance by pitch type. |
| `GET /api/health` | Which keys are configured. |

---

## Roadmap to rival Action

This is a working foundation. To close the gap:

1. **Ingest + cache Statcast into a database.** Right now Savant is queried live per request. A nightly
   ingest into Postgres (millions of pitches/season) makes arbitrary aggregations instant and lets the
   LLM write SQL for questions no endpoint anticipates (text-to-SQL).
2. **Expand markets & props** — alt lines, first-5-innings, NRFI, live odds movement / line history.
3. **Model layer** — implied probability vs your own projection to surface edges, not just raw numbers.
4. **More sports** — the router/plan architecture is sport-agnostic; add NBA/NFL sources behind the same
   `intent` contract.
5. **Notes on data:** Savant's CSV params are undocumented and shift occasionally — if a Statcast pull
   returns zero rows, verify the query in a browser at baseballsavant.mlb.com/statcast_search. Ingesting
   (step 1) removes this fragility.
