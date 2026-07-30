// ─────────────────────────────────────────────────────────────────────────
// Ingest: download nflverse play-by-play + participation + weekly stats for a
// season, join them, and aggregate into compact tables the server reads
// instantly. This is the "ingest into a DB" step — done as on-disk JSON so the
// app stays runnable with no database dependency.
//
//   node scripts/ingest.js 2024 [2023 …]     → data/nfl_<year>.json
//
// Produces, per season:
//   • defVsPos     — production each defense allows by position (WR/RB/TE),
//                    per game, with league ranks. The core matchup table.
//   • defTendencies— each defense's man/zone rate, coverage shell mix (Cover
//                    0–6), blitz rate, pressure rate, avg box. From participation.
//   • playerVsCoverage — per receiver: route distribution, and split
//                    performance vs MAN vs ZONE (targets, catch rate, yards).
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const REL = "https://github.com/nflverse/nflverse-data/releases/download";

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "gridiron-desk-ingest/0.1" }, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function tryUrls(urls) {
  for (const u of urls) {
    try { return await fetchText(u); } catch { /* next */ }
  }
  throw new Error(`none of: ${urls.join(", ")}`);
}

// Stream a CSV row-by-row, emitting only the projected columns (bounds memory
// on 90 MB+ files). Handles quoted fields containing commas/newlines.
function forEachRow(text, wanted, cb) {
  // First, read the header line honoring quotes.
  const headerCells = [];
  let i = 0, field = "", q = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { headerCells.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { headerCells.push(field); field = ""; if (c === "\r" && text[i + 1] === "\n") i++; i++; break; }
    else field += c;
  }
  const idx = {};
  wanted.forEach((w) => { idx[w] = headerCells.indexOf(w); });

  // Then rows.
  let col = 0, rec = {};
  field = ""; q = false;
  const flushField = () => {
    for (const w of wanted) if (idx[w] === col) rec[w] = field;
    field = ""; col++;
  };
  const flushRow = () => { flushField(); cb(rec); rec = {}; col = 0; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") flushField();
    else if (c === "\n" || c === "\r") {
      if (field !== "" || col > 0) flushRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || col > 0) flushRow();
}

const num = (v) => (v == null || v === "" || v === "NA" ? 0 : Number(v));
const posBucket = (p) => {
  p = (p || "").toUpperCase();
  if (p === "FB") return "RB";
  return ["QB", "RB", "WR", "TE"].includes(p) ? p : null;
};

async function ingestSeason(year) {
  console.log(`\n▶ ${year}`);

  // 1) player_id → position map (from weekly stats).
  console.log("  · weekly stats (positions)…");
  const statsCsv = await tryUrls([
    `${REL}/player_stats/stats_player_week_${year}.csv`,
    `${REL}/player_stats/player_stats_${year}.csv`,
  ]);
  const pos = new Map();
  forEachRow(statsCsv, ["player_id", "position", "player_display_name"], (r) => {
    if (r.player_id && !pos.has(r.player_id)) pos.set(r.player_id, { pos: r.position, name: r.player_display_name });
  });

  // 2) participation (formation/coverage/route), keyed by game|play.
  console.log("  · participation (coverage/route)…");
  const part = new Map();
  try {
    const pCsv = await tryUrls([`${REL}/pbp_participation/pbp_participation_${year}.csv`]);
    forEachRow(pCsv, ["old_game_id", "play_id", "defenders_in_box", "number_of_pass_rushers", "was_pressure", "route", "defense_man_zone_type", "defense_coverage_type"], (r) => {
      part.set(`${r.old_game_id}|${r.play_id}`, r);
    });
  } catch (e) {
    console.log(`    (participation unavailable for ${year}: ${e.message})`);
  }

  // 3) play-by-play — join + aggregate.
  console.log("  · play-by-play (94 MB, please wait)…");
  const pbpCsv = await tryUrls([`${REL}/pbp/play_by_play_${year}.csv`]);

  const defPos = {};   // defteam -> pos -> tallies
  const defGames = {}; // defteam -> Set(game)
  const tend = {};     // defteam -> tendency tallies
  const players = {};  // player_id -> route + man/zone splits

  const bump = (obj, k) => (obj[k] = obj[k] || {});

  forEachRow(pbpCsv, ["old_game_id", "play_id", "defteam", "play_type", "complete_pass", "yards_gained", "pass_touchdown", "rush_touchdown", "receiver_player_id", "rusher_player_id"], (r) => {
    const def = r.defteam;
    if (!def) return;
    (defGames[def] = defGames[def] || new Set()).add(r.old_game_id);
    const pj = part.get(`${r.old_game_id}|${r.play_id}`);

    if (r.play_type === "pass") {
      // Defense tendency (per defensive pass snap).
      const t = bump(tend, def);
      t.passSnaps = (t.passSnaps || 0) + 1;
      if (pj) {
        if (pj.defense_man_zone_type === "MAN_COVERAGE") t.man = (t.man || 0) + 1;
        else if (pj.defense_man_zone_type === "ZONE_COVERAGE") t.zone = (t.zone || 0) + 1;
        const cov = (pj.defense_coverage_type || "").trim();
        if (cov) { t.cov = t.cov || {}; t.cov[cov] = (t.cov[cov] || 0) + 1; }
        if (num(pj.number_of_pass_rushers) >= 5) t.blitz = (t.blitz || 0) + 1;
        if (pj.was_pressure === "1" || pj.was_pressure === "TRUE") t.pressure = (t.pressure || 0) + 1;
        if (pj.defenders_in_box) { t.boxSum = (t.boxSum || 0) + num(pj.defenders_in_box); t.boxN = (t.boxN || 0) + 1; }
      }
      // Defense vs position + player route/coverage splits (targeted receiver).
      const rid = r.receiver_player_id;
      if (rid) {
        const p = posBucket(pos.get(rid)?.pos);
        if (p) {
          const cell = bump(bump(defPos, def), p);
          cell.targets = (cell.targets || 0) + 1;
          if (r.complete_pass === "1") { cell.rec = (cell.rec || 0) + 1; cell.recYds = (cell.recYds || 0) + num(r.yards_gained); }
          if (r.pass_touchdown === "1") cell.recTd = (cell.recTd || 0) + 1;
        }
        const pr = bump(players, rid);
        pr.name = pr.name || pos.get(rid)?.name || null;
        pr.pos = pr.pos || pos.get(rid)?.pos || null;
        if (pj?.route) { pr.routes = pr.routes || {}; pr.routes[pj.route] = (pr.routes[pj.route] || 0) + 1; }
        if (pj?.defense_man_zone_type) {
          const side = pj.defense_man_zone_type === "MAN_COVERAGE" ? "man" : pj.defense_man_zone_type === "ZONE_COVERAGE" ? "zone" : null;
          if (side) {
            const s = (pr[side] = pr[side] || { tgt: 0, rec: 0, yds: 0 });
            s.tgt++; if (r.complete_pass === "1") { s.rec++; s.yds += num(r.yards_gained); }
          }
        }
      }
    } else if (r.play_type === "run") {
      const rid = r.rusher_player_id;
      if (rid) {
        const p = posBucket(pos.get(rid)?.pos);
        if (p) {
          const cell = bump(bump(defPos, def), p);
          cell.rushAtt = (cell.rushAtt || 0) + 1;
          cell.rushYds = (cell.rushYds || 0) + num(r.yards_gained);
          if (r.rush_touchdown === "1") cell.rushTd = (cell.rushTd || 0) + 1;
        }
      }
    }
  });

  // Finalize defVsPos: per-game rates + league ranks (recYds/g by position).
  const defVsPos = {};
  for (const [def, byPos] of Object.entries(defPos)) {
    const g = defGames[def]?.size || 1;
    defVsPos[def] = { games: g, pos: {} };
    for (const [p, c] of Object.entries(byPos)) {
      defVsPos[def].pos[p] = {
        recYdsPerGame: +((c.recYds || 0) / g).toFixed(1),
        recTdPerGame: +((c.recTd || 0) / g).toFixed(2),
        targetsPerGame: +((c.targets || 0) / g).toFixed(1),
        catchRate: c.targets ? +((100 * (c.rec || 0)) / c.targets).toFixed(1) : null,
        rushYdsPerGame: +((c.rushYds || 0) / g).toFixed(1),
        rushTdPerGame: +((c.rushTd || 0) / g).toFixed(2),
      };
    }
  }
  addRanks(defVsPos);

  // Finalize tendencies.
  const defTendencies = {};
  for (const [def, t] of Object.entries(tend)) {
    const cov = {};
    const covTotal = Object.values(t.cov || {}).reduce((a, b) => a + b, 0) || 1;
    for (const [k, v] of Object.entries(t.cov || {})) cov[k] = +((100 * v) / covTotal).toFixed(1);
    defTendencies[def] = {
      passSnaps: t.passSnaps || 0,
      manRate: t.passSnaps ? +((100 * (t.man || 0)) / (t.man + t.zone || 1)).toFixed(1) : null,
      zoneRate: t.passSnaps ? +((100 * (t.zone || 0)) / (t.man + t.zone || 1)).toFixed(1) : null,
      blitzRate: t.passSnaps ? +((100 * (t.blitz || 0)) / t.passSnaps).toFixed(1) : null,
      pressureRate: t.passSnaps ? +((100 * (t.pressure || 0)) / t.passSnaps).toFixed(1) : null,
      avgBox: t.boxN ? +(t.boxSum / t.boxN).toFixed(2) : null,
      coverage: cov,
    };
  }

  // Finalize player coverage/route splits — keep only meaningful volume.
  const playerVsCoverage = {};
  for (const [rid, pr] of Object.entries(players)) {
    const total = (pr.man?.tgt || 0) + (pr.zone?.tgt || 0);
    if (total < 20 || !pr.name) continue;
    const routes = Object.entries(pr.routes || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const routeTotal = routes.reduce((a, [, v]) => a + v, 0) || 1;
    playerVsCoverage[normName(pr.name)] = {
      name: pr.name,
      pos: pr.pos,
      vsMan: split(pr.man),
      vsZone: split(pr.zone),
      routes: routes.map(([r, v]) => ({ route: r, pct: +((100 * v) / routeTotal).toFixed(1) })),
    };
  }

  mkdirSync(DATA, { recursive: true });
  const out = join(DATA, `nfl_${year}.json`);
  writeFileSync(out, JSON.stringify({ year, defVsPos, defTendencies, playerVsCoverage }));
  console.log(`  ✓ wrote ${out}  (${Object.keys(defVsPos).length} defenses, ${Object.keys(playerVsCoverage).length} receivers)`);
}

function split(s) {
  if (!s || !s.tgt) return null;
  return { targets: s.tgt, catchRate: +((100 * s.rec) / s.tgt).toFixed(1), ydsPerTarget: +(s.yds / s.tgt).toFixed(2) };
}
function normName(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
}
// Add a 1–32 league rank per position per metric (1 = allows the most).
function addRanks(defVsPos) {
  const positions = ["WR", "RB", "TE"];
  const metrics = ["recYdsPerGame", "rushYdsPerGame"];
  for (const p of positions) {
    for (const m of metrics) {
      const entries = Object.entries(defVsPos).filter(([, d]) => d.pos[p]?.[m] != null);
      entries.sort((a, b) => b[1].pos[p][m] - a[1].pos[p][m]);
      entries.forEach(([, d], i) => { d.pos[p].ranks = d.pos[p].ranks || {}; d.pos[p].ranks[m] = i + 1; });
    }
  }
}

const years = process.argv.slice(2).map(Number).filter(Boolean);
if (!years.length) {
  console.error("usage: node scripts/ingest.js <year> [year …]   e.g. node scripts/ingest.js 2024");
  process.exit(1);
}
for (const y of years) {
  try { await ingestSeason(y); } catch (e) { console.error(`  ✗ ${y}: ${e.message}`); }
}
