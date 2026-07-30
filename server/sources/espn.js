// ─────────────────────────────────────────────────────────────────────────
// ESPN NFL API  (site.api.espn.com / site.web.api.espn.com)
//
// Free, no-auth JSON — the box-score backbone: player resolution, per-game
// logs, situational splits, and team defensive stats. This is the NFL analog
// of the MLB Stats API. Advanced play-level data (EPA, target share, air
// yards) comes from nflverse (see nflverse.js).
//
// NOTE: ESPN's endpoints are unofficial and their shapes shift occasionally.
// Parsers here probe defensively; if a call returns nothing, verify the shape
// in a browser against the URL in the failing function.
// ─────────────────────────────────────────────────────────────────────────

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl";
const SEARCH = "https://site.web.api.espn.com/apis/search/v2";

async function jget(url) {
  const r = await fetch(url, { headers: { "User-Agent": "gridiron-desk/0.1" } });
  if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
  return r.json();
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

// Pull the first numeric athlete id out of an ESPN uid/guid/link like
// "s:20~l:28~a:3139477" or ".../athletes/3139477".
function extractAthleteId(obj) {
  for (const v of [obj?.uid, obj?.guid, obj?.link?.href, obj?.id, ...(obj?.links || []).map((l) => l.href)]) {
    if (!v) continue;
    const m = String(v).match(/a:(\d+)/) || String(v).match(/athletes\/(\d+)/) || String(v).match(/^(\d+)$/);
    if (m) return m[1];
  }
  return null;
}

/* ── Player resolution via ESPN search ─────────────────────────────────── */
export async function resolvePlayer(name) {
  const target = norm(name);
  if (!target) return null;
  let data;
  try {
    data = await jget(`${SEARCH}?query=${encodeURIComponent(name)}&limit=12&sport=football&league=nfl`);
  } catch {
    return null;
  }
  // Results live under contents / items depending on shape; flatten anything
  // that looks like a player.
  const buckets = [
    ...(data.results || []).flatMap((r) => r.contents || r.items || []),
    ...(data.items || []),
    ...(data.contents || []),
  ];
  const candidates = buckets.filter((c) => {
    const t = (c.type || c.sport || "").toLowerCase();
    return t.includes("player") || t.includes("athlete") || c.subject === "player";
  });
  const pick =
    candidates.find((c) => norm(c.displayName || c.name || c.title) === target) ||
    candidates.find((c) => norm(c.displayName || c.name || c.title).includes(target)) ||
    candidates[0];
  if (!pick) return null;
  const id = extractAthleteId(pick);
  if (!id) return null;
  return {
    id,
    name: pick.displayName || pick.name || pick.title,
    position: pick.subtitle || pick.position || "",
    team: pick.description || null,
  };
}

/* ── Per-game log ──────────────────────────────────────────────────────── */
// Returns rows: { date, week, opponent, isHome, result, stats: {LABEL: value} }
export async function gameLog(playerId, season) {
  const url = `${WEB}/athletes/${playerId}/gamelog${season ? `?season=${season}` : ""}`;
  const d = await jget(url);
  const labels = d.labels || d.names || [];
  const meta = d.events || {};
  const rows = [];
  for (const st of d.seasonTypes || []) {
    for (const cat of st.categories || [st]) {
      for (const ev of cat.events || []) {
        const m = meta[ev.eventId] || {};
        const statsArr = ev.stats || [];
        const stats = Object.fromEntries(labels.map((l, i) => [l, statsArr[i]]));
        rows.push({
          date: m.gameDate ? String(m.gameDate).slice(0, 10) : null,
          week: m.week ?? null,
          opponent: m.opponent?.abbreviation || m.opponent?.displayName || "",
          isHome: m.atVs === "vs" || m.homeAway === "home",
          result: m.gameResult || m.result || "",
          season: st.season?.year || season || null,
          stats,
        });
      }
    }
  }
  return rows.sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
}

export async function lastNGames(playerId, n = 10, season) {
  const year = season || new Date().getFullYear();
  let games = await gameLog(playerId, year).catch(() => []);
  if (games.length < n) {
    const prev = await gameLog(playerId, year - 1).catch(() => []);
    games = games.concat(prev);
  }
  return games.slice(0, n);
}

/* ── Situational splits (home/away, vs division, by result) ────────────── */
export async function splits(playerId, season) {
  const url = `${WEB}/athletes/${playerId}/splits${season ? `?season=${season}` : ""}`;
  const d = await jget(url);
  const labels = (d.labels || d.names || []).map((x) => x);
  const out = [];
  for (const cat of d.splitCategories || []) {
    for (const sp of cat.splits || []) {
      out.push({
        category: cat.displayName || cat.name,
        name: sp.displayName || sp.name,
        stats: Object.fromEntries(labels.map((l, i) => [l, (sp.stats || [])[i]])),
      });
    }
  }
  return { labels, splits: out };
}

/* ── Team lookup + defensive stats (for matchups) ──────────────────────── */
let _teamCache = null;
export async function teams() {
  if (_teamCache) return _teamCache;
  const d = await jget(`${SITE}/teams`);
  const list = (d.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => t.team).map((t) => ({
    id: t.id,
    abbr: t.abbreviation,
    name: t.displayName,
    location: t.location,
    nickname: t.name,
  }));
  _teamCache = list;
  return list;
}

export async function resolveTeam(name) {
  const t = norm(name);
  const list = await teams();
  return (
    list.find((x) => norm(x.name) === t || norm(x.nickname) === t || x.abbr?.toLowerCase() === t) ||
    list.find((x) => norm(x.name).includes(t) || t.includes(norm(x.nickname))) ||
    null
  );
}

// Opponent defense summary — season statistics for a team, filtered to the
// defensive categories a bettor cares about (yards/points allowed).
export async function teamDefense(teamId, season) {
  const yr = season || new Date().getFullYear();
  const url = `${SITE}/teams/${teamId}/statistics${yr ? `?season=${yr}` : ""}`;
  const d = await jget(url).catch(() => null);
  if (!d) return null;
  const cats = d.results?.stats?.categories || d.statistics?.splits?.categories || [];
  const wanted = {};
  for (const cat of cats) {
    for (const s of cat.stats || []) {
      const key = (s.name || s.abbreviation || "").toLowerCase();
      if (/allowed|against|pointsagainst|yardsagainst/.test(key) || cat.name === "defensive")
        wanted[s.displayName || s.name] = s.displayValue ?? s.value;
    }
  }
  return { season: yr, stats: wanted };
}
