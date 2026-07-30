# Gridiron Desk

Natural-language NFL betting & stats research — an Action Network–style desk for football.
Ask questions in plain English and get answers from play-by-play–derived advanced data, weekly
game logs, situational splits, and live sportsbook lines.

> **Research tool, not betting advice.** Verify every line with your book before wagering.

---

## What it can answer today

| You ask… | It uses… |
|---|---|
| "CeeDee Lamb vs the Lions matchup" | **Full blend:** player usage + man/zone splits, overlaid on the defense's position grade + coverage tendencies |
| "Which defense allows the most receiving yards to WRs?" | Defense-vs-position leaderboard (ranked 1–32) |
| "How does the 49ers defense handle tight ends?" | One defense's position grade + scheme |
| "How much man coverage do the Ravens play?" | Coverage & blitz tendencies (man/zone rate, Cover 0–6 shells, pressure) |
| "What routes does Justin Jefferson run, and how's he do vs man?" | Route tree + man-vs-zone catch rate / yards per target |
| "What's CeeDee Lamb's target share and air yards?" | Advanced usage — the prop-driving signals |
| "How many games did Josh Allen throw for 300+ yards?" | Weekly game-log threshold scan |
| "NFL spreads and totals this week" | Live lines across DraftKings, FanDuel, BetMGM, Caesars… |

## The matchup engine (built from play-by-play)

The betting edge lives in **matchups**, and those are computed from every play of the season via an
ingest step (`scripts/ingest.js`) that joins nflverse play-by-play + participation data:

- **Defense vs position** — receiving/rushing yards, TDs, and catch rate each defense allows to WRs,
  RBs, and TEs, per game, ranked 1–32. (Rank 1 = softest matchup.)
- **Coverage & scheme tendencies** — man vs zone rate, the full Cover 0–6 shell distribution, blitz
  rate, pressure rate, and average box count. From NFL Next Gen Stats participation data.
- **Route trees & coverage splits** — every receiver's route distribution when targeted, and how
  they perform **vs man vs zone** (catch rate, yards per target).

The **matchup** view fuses these: a high-target-share receiver who thrives vs zone, facing a
zone-heavy defense that's soft to his position, is the setup you're hunting.

> **What's *not* free:** per-route separation/cushion charting (that's PFF / Sports Info Solutions).
> Everything above — routes run, coverage shells, formation, personnel, blitz — is in nflverse for
> 2016–2024.

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
cp .env.example .env             # then fill in your keys (both optional)
node scripts/ingest.js 2024      # build the matchup tables (~10s, one-time per season)
npm start                        # → http://localhost:8787
```

`data/nfl_2024.json` is committed, so matchups work out of the box; re-run the ingest to add more
seasons (`node scripts/ingest.js 2023 2022`). The file is ~0.15 MB per season.

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
| `GET /api/defense/:team?year=YYYY` | A defense's position grades + coverage tendencies. |
| `GET /api/defense-leaderboard?position=WR&metric=recYdsPerGame` | Defenses ranked by what they allow. |
| `GET /api/routes/:name?year=YYYY` | A receiver's route tree + man/zone splits. |
| `GET /api/health` | Keys configured + ingested season. |

---

## Roadmap to rival Action

Done so far: **play-by-play ingest** (`scripts/ingest.js`) and **real defense-vs-position + coverage
+ route tables**. Next:

1. **Opponent-weighted tendencies.** Split each defense's coverage mix by the *specific* offense it
   faces (thin samples, but the "what will they run against *this* team" read you asked about). The
   ingest already keys everything by game, so it's an aggregation change.
2. **Text-to-SQL.** Load the ingested tables into SQLite and let the LLM write SQL for questions no
   handler anticipates — "TE yards allowed by Cover-3 defenses on 3rd down".
3. **Props + edges** — pull player props (already supported via `/api/odds/:eventId/props`), convert
   to implied probability, and compare against a projection built from usage × matchup to surface value.
4. **Line movement** — snapshot odds over time for steam/reverse-line-movement reads.
5. **Next Gen Stats** — separation, cushion, time-to-throw, rush yards over expected (nflverse
   `nextgen` releases) for even sharper matchup grades.

**Data notes:** nflverse renames release assets occasionally (the ingest tries current + legacy
names); NFL participation data (coverage/route) covers 2016–2024. Per-route separation charting is
paid (PFF / SIS) and not included.
