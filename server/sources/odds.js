// ─────────────────────────────────────────────────────────────────────────
// The Odds API  (the-odds-api.com)  — betting lines across major books
//
// Real sportsbook lines can't be scraped reliably or legally client-side, so
// this uses a licensed aggregator. Free tier ~500 requests/month covers
// DraftKings, FanDuel, BetMGM, Caesars, and more. Set ODDS_API_KEY to enable.
//
// We normalize each book's markets into a compact shape the frontend can
// render as a price grid, and expose game lines (moneyline / spread / total)
// plus optional player props per event.
// ─────────────────────────────────────────────────────────────────────────

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_nfl";

function key() {
  const k = process.env.ODDS_API_KEY;
  if (!k) {
    const e = new Error("ODDS_API_KEY not set — betting lines are unavailable.");
    e.code = "NO_ODDS_KEY";
    throw e;
  }
  return k;
}

async function jget(path, params = {}) {
  const q = new URLSearchParams({ apiKey: key(), ...params });
  const r = await fetch(`${BASE}${path}?${q.toString()}`);
  if (r.status === 401) throw Object.assign(new Error("Odds API key rejected."), { code: "BAD_ODDS_KEY" });
  if (r.status === 429) throw Object.assign(new Error("Odds API quota exhausted."), { code: "ODDS_QUOTA" });
  if (!r.ok) throw new Error(`Odds API ${r.status}`);
  return r.json();
}

/* ── Game lines: moneyline, run line, total ────────────────────────────── */
export async function gameLines({ regions = "us", markets = "h2h,spreads,totals" } = {}) {
  const events = await jget(`/sports/${SPORT}/odds`, {
    regions,
    markets,
    oddsFormat: "american",
    dateFormat: "iso",
  });
  return events.map((ev) => ({
    id: ev.id,
    commence: ev.commence_time,
    home: ev.home_team,
    away: ev.away_team,
    books: (ev.bookmakers || []).map((b) => ({
      book: b.title,
      markets: Object.fromEntries(
        (b.markets || []).map((m) => [
          m.key,
          (m.outcomes || []).map((o) => ({ name: o.name, price: o.price, point: o.point ?? null })),
        ])
      ),
    })),
  }));
}

/* ── Player props for one game (HR, hits, total bases, strikeouts, …) ──── */
export async function playerProps(eventId, { regions = "us", markets } = {}) {
  const defaultMarkets = [
    "player_pass_yds", "player_pass_tds", "player_rush_yds",
    "player_reception_yds", "player_receptions", "player_anytime_td",
  ].join(",");
  const ev = await jget(`/sports/${SPORT}/events/${eventId}/odds`, {
    regions,
    markets: markets || defaultMarkets,
    oddsFormat: "american",
  });
  return {
    id: ev.id,
    home: ev.home_team,
    away: ev.away_team,
    books: (ev.bookmakers || []).map((b) => ({
      book: b.title,
      markets: Object.fromEntries(
        (b.markets || []).map((m) => [
          m.key,
          (m.outcomes || []).map((o) => ({
            name: o.name,
            player: o.description ?? null,
            price: o.price,
            point: o.point ?? null,
          })),
        ])
      ),
    })),
  };
}
