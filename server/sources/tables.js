// ─────────────────────────────────────────────────────────────────────────
// Precomputed matchup tables — served from data/nfl_<year>.json, produced by
// scripts/ingest.js. Instant reads for defense-vs-position, defensive
// coverage/formation tendencies, and player route/coverage splits.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const cache = new Map();

function load(year) {
  if (cache.has(year)) return cache.get(year);
  const f = join(DATA, `nfl_${year}.json`);
  if (!existsSync(f)) {
    const e = new Error(`No matchup tables for ${year}. Run: node scripts/ingest.js ${year}`);
    e.code = "NOT_INGESTED";
    throw e;
  }
  const data = JSON.parse(readFileSync(f, "utf8"));
  cache.set(year, data);
  return data;
}

// Latest ingested season (falls back through recent years).
export function latestSeason() {
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 6; y--) if (existsSync(join(DATA, `nfl_${y}.json`))) return y;
  return null;
}

/* ── Team name → nflverse abbreviation ─────────────────────────────────── */
const TEAM = {
  ARI: ["arizona", "cardinals"], ATL: ["atlanta", "falcons"], BAL: ["baltimore", "ravens"],
  BUF: ["buffalo", "bills"], CAR: ["carolina", "panthers"], CHI: ["chicago", "bears"],
  CIN: ["cincinnati", "bengals"], CLE: ["cleveland", "browns"], DAL: ["dallas", "cowboys"],
  DEN: ["denver", "broncos"], DET: ["detroit", "lions"], GB: ["green bay", "packers"],
  HOU: ["houston", "texans"], IND: ["indianapolis", "colts"], JAX: ["jacksonville", "jaguars", "jags"],
  KC: ["kansas city", "chiefs"], LA: ["los angeles rams", "la rams", "rams"], LAC: ["los angeles chargers", "la chargers", "chargers"],
  LV: ["las vegas", "raiders"], MIA: ["miami", "dolphins"], MIN: ["minnesota", "vikings", "vikes"],
  NE: ["new england", "patriots", "pats"], NO: ["new orleans", "saints"], NYG: ["new york giants", "ny giants", "giants"],
  NYJ: ["new york jets", "ny jets", "jets"], PHI: ["philadelphia", "eagles"], PIT: ["pittsburgh", "steelers"],
  SEA: ["seattle", "seahawks"], SF: ["san francisco", "49ers", "niners"], TB: ["tampa bay", "buccaneers", "bucs"],
  TEN: ["tennessee", "titans"], WAS: ["washington", "commanders"],
};
export function teamAbbr(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  if (TEAM[n.toUpperCase()]) return n.toUpperCase();
  for (const [abbr, names] of Object.entries(TEAM)) if (names.some((x) => n.includes(x) || x.includes(n))) return abbr;
  return null;
}
export function teamName(abbr) {
  const names = TEAM[abbr];
  return names ? names[names.length - 1].replace(/\b\w/g, (c) => c.toUpperCase()) : abbr;
}

/* ── Getters ───────────────────────────────────────────────────────────── */
export function defenseVsPosition(abbr, year) {
  const d = load(year || latestSeason());
  return d.defVsPos[abbr] || null;
}
export function defenseTendencies(abbr, year) {
  const d = load(year || latestSeason());
  return d.defTendencies[abbr] || null;
}

// League table: teams ranked by a stat allowed to a position.
export function defenseLeaderboard(position, metric, year) {
  const d = load(year || latestSeason());
  const rows = Object.entries(d.defVsPos)
    .filter(([, x]) => x.pos[position]?.[metric] != null)
    .map(([team, x]) => ({ team, name: teamName(team), value: x.pos[position][metric], rank: x.pos[position].ranks?.[metric] }))
    .sort((a, b) => b.value - a.value);
  return { year: d.year, position, metric, rows };
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
export function playerCoverage(name, year) {
  const d = load(year || latestSeason());
  const t = norm(name);
  if (d.playerVsCoverage[t]) return d.playerVsCoverage[t];
  const key = Object.keys(d.playerVsCoverage).find((k) => k.includes(t) || t.includes(k));
  return key ? d.playerVsCoverage[key] : null;
}
