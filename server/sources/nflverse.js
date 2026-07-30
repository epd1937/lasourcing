// ─────────────────────────────────────────────────────────────────────────
// nflverse  (github.com/nflverse/nflverse-data)  — advanced NFL data
//
// The differentiator vs a box-score app. nflverse publishes weekly player
// stats derived from full play-by-play: EPA, target share, air yards share,
// WOPR, aDOT, YAC — the numbers that actually predict props (target share →
// receptions; air yards → receiving yards). Released as CSV on GitHub, which
// this sandbox can reach; a full season is a few thousand rows, cached here.
//
// This is the NFL analog of Baseball Savant / Statcast.
// ─────────────────────────────────────────────────────────────────────────

// nflverse renamed assets over time; try newest → oldest.
function releaseUrls(year) {
  const rel = "https://github.com/nflverse/nflverse-data/releases/download/player_stats";
  return [
    `${rel}/stats_player_week_${year}.csv`,
    `${rel}/player_stats_${year}.csv`,
  ];
}

const seasonCache = new Map();

function parseCsv(text) {
  const rows = [];
  let f = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (f !== "" || row.length) { row.push(f); rows.push(row); row = []; f = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function loadSeason(year) {
  if (seasonCache.has(year)) return seasonCache.get(year);
  let rows = null;
  for (const url of releaseUrls(year)) {
    const r = await fetch(url, { headers: { "User-Agent": "gridiron-desk/0.1" }, redirect: "follow" });
    if (r.ok) { rows = parseCsv(await r.text()); break; }
  }
  if (!rows) throw new Error(`nflverse: no player_stats release found for ${year}`);
  seasonCache.set(year, rows);
  return rows;
}

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();

// Tolerant column read — nflverse column names drift across versions.
const col = (row, ...names) => {
  for (const n of names) if (row[n] != null && row[n] !== "") return row[n];
  return null;
};
const num = (v) => (v == null || v === "" || v === "NA" ? null : Number(v));

// Shared: the regular-season weekly rows for one player in a season.
async function playerRows(name, year) {
  const rows = await loadSeason(year);
  const target = norm(name);
  const exact = rows.filter((r) => norm(col(r, "player_display_name", "player_name")) === target);
  const rowset = exact.length
    ? exact
    : rows.filter((r) => {
        const dn = norm(col(r, "player_display_name", "player_name"));
        return dn.includes(target) || target.includes(dn);
      });
  return rowset.filter((r) => (col(r, "season_type") || "REG").toUpperCase() === "REG");
}

// Plain-English stat name → nflverse weekly column.
const STAT_COL = {
  "passing yards": "passing_yards", "pass yards": "passing_yards",
  "passing tds": "passing_tds", "passing touchdowns": "passing_tds",
  "completions": "completions", "attempts": "attempts", "interceptions": "interceptions",
  "rushing yards": "rushing_yards", "rush yards": "rushing_yards",
  "rushing tds": "rushing_tds", "rushing touchdowns": "rushing_tds", "carries": "carries",
  "receiving yards": "receiving_yards", "rec yards": "receiving_yards",
  "receptions": "receptions", "catches": "receptions", "targets": "targets",
  "receiving tds": "receiving_tds", "receiving touchdowns": "receiving_tds",
};
export function statColumn(name) {
  return STAT_COL[String(name || "").toLowerCase().trim()] || null;
}

// Per-week game log with clean typed stats — used for counts and logs.
export async function weeklyLog(name, year) {
  const yr = year || new Date().getFullYear();
  const mine = await playerRows(name, yr);
  if (!mine.length) return { year: yr, found: false, player: name, games: [] };
  const games = mine
    .map((r) => ({
      season: yr,
      week: num(col(r, "week")),
      opponent: col(r, "opponent_team", "opponent"),
      stats: {
        passing_yards: num(col(r, "passing_yards")) || 0,
        passing_tds: num(col(r, "passing_tds")) || 0,
        interceptions: num(col(r, "interceptions")) || 0,
        completions: num(col(r, "completions")) || 0,
        attempts: num(col(r, "attempts")) || 0,
        rushing_yards: num(col(r, "rushing_yards")) || 0,
        rushing_tds: num(col(r, "rushing_tds")) || 0,
        carries: num(col(r, "carries", "rushing_attempts")) || 0,
        receiving_yards: num(col(r, "receiving_yards")) || 0,
        receptions: num(col(r, "receptions")) || 0,
        targets: num(col(r, "targets")) || 0,
        receiving_tds: num(col(r, "receiving_tds")) || 0,
      },
    }))
    .sort((a, b) => (b.week || 0) - (a.week || 0));
  return { year: yr, found: true, player: col(mine[0], "player_display_name", "player_name"), position: col(mine[0], "position"), games };
}

/* ── A player's advanced season profile ────────────────────────────────── */
export async function playerAdvanced(name, year) {
  const yr = year || new Date().getFullYear();
  const mine = await playerRows(name, yr);
  if (!mine.length) return { year: yr, found: false };

  const games = mine.length;
  const sum = (...keys) => mine.reduce((a, r) => a + (num(col(r, ...keys)) || 0), 0);
  const meanOf = (...keys) => {
    const vals = mine.map((r) => num(col(r, ...keys))).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const rnd = (v, d = 1) => (v == null ? null : +v.toFixed(d));

  const targets = sum("targets");
  const receptions = sum("receptions");
  const recAirYards = sum("receiving_air_yards");
  const first = mine[0];

  return {
    year: yr,
    found: true,
    player: col(first, "player_display_name", "player_name"),
    position: col(first, "position", "position_group"),
    team: col(first, "recent_team", "team"),
    games,
    passing: {
      yards: sum("passing_yards"),
      tds: sum("passing_tds"),
      ints: sum("interceptions"),
      epa: rnd(sum("passing_epa"), 1),
      epaPerGame: rnd(sum("passing_epa") / games, 2),
    },
    rushing: {
      yards: sum("rushing_yards"),
      tds: sum("rushing_tds"),
      carries: sum("carries", "rushing_attempts"),
      epa: rnd(sum("rushing_epa"), 1),
    },
    receiving: {
      receptions,
      targets,
      yards: sum("receiving_yards"),
      tds: sum("receiving_tds"),
      airYards: recAirYards,
      yac: sum("receiving_yards_after_catch"),
      catchRate: targets ? rnd(100 * receptions / targets, 1) : null,
      aDOT: targets ? rnd(recAirYards / targets, 1) : null,
      targetShare: rnd(meanOf("target_share") * 100, 1),
      airYardsShare: rnd(meanOf("air_yards_share") * 100, 1),
      wopr: rnd(meanOf("wopr"), 2),          // weighted opportunity rating
      racr: rnd(meanOf("racr"), 2),
      epa: rnd(sum("receiving_epa"), 1),
    },
    fantasy: {
      pprTotal: rnd(sum("fantasy_points_ppr"), 1),
      pprPerGame: rnd(sum("fantasy_points_ppr") / games, 1),
    },
  };
}
