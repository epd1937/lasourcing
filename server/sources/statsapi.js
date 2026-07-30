// ─────────────────────────────────────────────────────────────────────────
// MLB Stats API  (statsapi.mlb.com)
//
// Public, no-auth, permissive-CORS JSON. This is the backbone: rosters,
// per-game logs, situational splits (vs LHP / RHP), pitching lines, and
// postseason data. It does NOT carry pitch-level data — that's Baseball
// Savant (see savant.js).
// ─────────────────────────────────────────────────────────────────────────

const API = "https://statsapi.mlb.com/api/v1";

async function jget(url) {
  const r = await fetch(url, { headers: { "User-Agent": "diamond-desk/0.1" } });
  if (!r.ok) throw new Error(`StatsAPI ${r.status} for ${url}`);
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

/* ── Player resolution ─────────────────────────────────────────────────── */
// StatsAPI has no reliable public name-search, so we search full season
// rosters (which we cache). Current-season stars resolve in one request;
// retired players walk back through history until found.
const seasonCache = new Map();

async function playersForSeason(year) {
  if (seasonCache.has(year)) return seasonCache.get(year);
  const d = await jget(`${API}/sports/1/players?season=${year}`);
  const list = (d.people || []).map((p) => ({
    id: p.id,
    name: p.fullName,
    position: p.primaryPosition?.abbreviation || "",
    bats: p.batSide?.code || null,
    throws: p.pitchHand?.code || null,
  }));
  seasonCache.set(year, list);
  return list;
}

export async function resolvePlayer(name) {
  const target = norm(name);
  if (!target) return null;
  const now = new Date().getFullYear();
  for (let y = now; y >= 1950; y -= y > now - 6 ? 1 : 3) {
    let list;
    try {
      list = await playersForSeason(y);
    } catch {
      continue;
    }
    let hit = list.find((p) => norm(p.name) === target);
    if (!hit) hit = list.find((p) => norm(p.name).includes(target) || target.includes(norm(p.name)));
    if (hit) return hit;
  }
  return null;
}

/* ── Which seasons a player was active (for career scans) ──────────────── */
export async function playerSeasons(playerId, group = "hitting") {
  try {
    const d = await jget(
      `${API}/people/${playerId}?hydrate=stats(group=[${group}],type=[yearByYear])`
    );
    const splits = (((d.people || [])[0] || {}).stats || []).flatMap((s) => s.splits || []);
    const years = [...new Set(splits.map((s) => parseInt(s.season, 10)).filter(Boolean))];
    if (years.length) return years.sort();
  } catch {
    /* fall through */
  }
  const now = new Date().getFullYear();
  return Array.from({ length: now - 2008 + 1 }, (_, i) => 2008 + i);
}

/* ── Per-game logs ─────────────────────────────────────────────────────── */
// gameTypes: R = regular season, P/D/L/W/F = postseason rounds.
export async function gameLog(playerId, season, group = "hitting", gameTypes = ["R"]) {
  const gt = gameTypes.join(",");
  const d = await jget(
    `${API}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}&gameType=${gt}`
  );
  const stat = (d.stats || [])[0] || {};
  return (stat.splits || []).map((s) => ({
    date: s.date,
    season,
    opponent: s.opponent?.name || "",
    isHome: s.isHome,
    stats: s.stat || {},
  }));
}

// All matching games across a set of seasons (career or single year), sorted
// newest-first.
export async function gameLogsAcross(playerId, seasons, group = "hitting", gameTypes = ["R"]) {
  const chunks = await Promise.all(
    seasons.map((yr) => gameLog(playerId, yr, group, gameTypes).catch(() => []))
  );
  return chunks.flat().sort((a, b) => (a.date < b.date ? 1 : -1));
}

// The last N games (default 10) — the workhorse for "over the last 10" bets.
export async function lastNGames(playerId, n = 10, group = "hitting") {
  const now = new Date().getFullYear();
  // Pull this season and, if short, the previous — enough to fill N.
  let games = await gameLog(playerId, now, group).catch(() => []);
  if (games.length < n) {
    const prev = await gameLog(playerId, now - 1, group).catch(() => []);
    games = games.concat(prev);
  }
  return games.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
}

/* ── Situational splits: vs LHP / RHP ──────────────────────────────────── */
// sitCodes: vl = vs left-handed pitching, vr = vs right-handed pitching.
export async function splitsVsHand(playerId, season, group = "hitting") {
  const d = await jget(
    `${API}/people/${playerId}/stats?stats=statSplits&sitCodes=vl,vr&group=${group}&season=${season}`
  );
  const out = { vsL: null, vsR: null };
  for (const block of d.stats || []) {
    for (const sp of block.splits || []) {
      const code = sp.split?.code;
      if (code === "vl") out.vsL = sp.stat;
      else if (code === "vr") out.vsR = sp.stat;
    }
  }
  return out;
}
