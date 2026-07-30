// ─────────────────────────────────────────────────────────────────────────
// /api/ask — parse the question, run the matching handler, return
// { plan, result }. Each result carries a `kind` the frontend renders.
//
// Game logs / counts / advanced usage come from nflverse (clean typed columns
// derived from play-by-play). Situational splits and opponent-defense come
// from ESPN. Odds come from The Odds API.
// ─────────────────────────────────────────────────────────────────────────

import { planQuery } from "../llm.js";
import * as espn from "../sources/espn.js";
import * as nfl from "../sources/nflverse.js";
import * as odds from "../sources/odds.js";
import * as tables from "../sources/tables.js";

const now = () => new Date().getFullYear();

function passes(v, op, t) {
  v = Number(v || 0);
  switch (op) {
    case "gt": return v > t;
    case "eq": return v === t;
    case "lt": return v < t;
    case "lte": return v <= t;
    default: return v >= t;
  }
}

const STAT_LABEL = {
  passing_yards: "passing yards", passing_tds: "passing TDs", interceptions: "interceptions",
  completions: "completions", attempts: "attempts", rushing_yards: "rushing yards",
  rushing_tds: "rushing TDs", carries: "carries", receiving_yards: "receiving yards",
  receptions: "receptions", targets: "targets", receiving_tds: "receiving TDs",
};

function userErr(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  return e;
}

// count_games: threshold over weekly logs, single season or recent career.
async function countGames(plan) {
  const column = nfl.statColumn(plan.stat) || "passing_yards";
  const op = plan.operator || "gte";
  const t = plan.threshold ?? 1;
  const tf = plan.timeframe || { type: "career" };
  const seasons =
    tf.type === "season" && tf.season
      ? [tf.season]
      : Array.from({ length: 6 }, (_, i) => now() - i); // recent career window

  const logs = await Promise.all(seasons.map((yr) => nfl.weeklyLog(plan.player, yr).catch(() => ({ games: [] }))));
  const found = logs.find((l) => l.found);
  if (!found) throw userErr(`No nflverse data found for "${plan.player}".`);
  const all = logs.flatMap((l) => l.games.map((g) => ({ ...g })));
  const matches = all.filter((g) => passes(g.stats[column], op, t)).sort((a, b) => (b.season - a.season) || (b.week - a.week));

  return {
    kind: "count",
    player: found.player,
    column,
    statLabel: STAT_LABEL[column] || column,
    operator: op,
    threshold: t,
    scope: tf.type === "season" ? `${tf.season}` : `${seasons[seasons.length - 1]}–${seasons[0]}`,
    count: matches.length,
    games: matches.slice(0, 200),
  };
}

async function playerSplits(plan) {
  const tf = plan.timeframe || { type: "season" };
  if (tf.type === "lastN") {
    const log = await nfl.weeklyLog(plan.player, tf.season || now());
    if (!log.found) throw userErr(`No data for "${plan.player}".`);
    return { kind: "lastN", player: log.player, n: tf.lastN || 5, games: log.games.slice(0, tf.lastN || 5) };
  }
  // ESPN situational splits (home/away, vs division, …).
  const player = await espn.resolvePlayer(plan.player);
  if (!player) throw userErr(`Couldn't resolve "${plan.player}" on ESPN.`);
  const data = await espn.splits(player.id, tf.season);
  return { kind: "splits", player, season: tf.season || now(), ...data };
}

async function playerAdvanced(plan) {
  const adv = await nfl.playerAdvanced(plan.player, plan.timeframe?.season);
  if (!adv.found) throw userErr(`No nflverse data found for "${plan.player}" in ${adv.year}.`);
  return { kind: "advanced", ...adv, phase: plan.phase || null };
}

// route_profile: a receiver's route tree + man/zone splits (ingested tables).
async function routeProfile(plan) {
  const year = plan.timeframe?.season || tables.latestSeason();
  const cov = tables.playerCoverage(plan.player, year);
  if (!cov) throw userErr(`No route/coverage data for "${plan.player}" in ${year}. Ingest that season first.`);
  return { kind: "route_profile", year, ...cov };
}

// defense_vs_position: a single defense's grade, or a league leaderboard.
async function defenseVsPosition(plan) {
  const year = plan.timeframe?.season || tables.latestSeason();
  const pos = plan.position || "WR";
  const metric = pos === "RB" ? "rushYdsPerGame" : "recYdsPerGame";
  const teamName = plan.team || plan.opponent;
  if (teamName) {
    const abbr = tables.teamAbbr(teamName);
    if (!abbr) throw userErr(`Couldn't identify the team "${teamName}".`);
    const dvp = tables.defenseVsPosition(abbr, year);
    const tend = tables.defenseTendencies(abbr, year);
    if (!dvp) throw userErr(`No data for ${tables.teamName(abbr)} in ${year}.`);
    return { kind: "defense_vs_position_team", year, team: abbr, teamName: tables.teamName(abbr), position: pos, row: dvp.pos[pos] || null, games: dvp.games, tendencies: tend };
  }
  const board = tables.defenseLeaderboard(pos, metric, year);
  return { kind: "defense_leaderboard", ...board };
}

async function defenseTendencies(plan) {
  const year = plan.timeframe?.season || tables.latestSeason();
  const abbr = tables.teamAbbr(plan.team || plan.opponent);
  if (!abbr) throw userErr(`Name a team (e.g. "the Ravens").`);
  const tend = tables.defenseTendencies(abbr, year);
  if (!tend) throw userErr(`No tendency data for ${tables.teamName(abbr)} in ${year}.`);
  return { kind: "defense_tendencies", year, team: abbr, teamName: tables.teamName(abbr), tendencies: tend };
}

// matchup: the full blend — player usage + route/coverage splits, overlaid on
// the opponent defense's position grade AND its coverage tendencies.
async function matchup(plan) {
  const year = plan.timeframe?.season || tables.latestSeason();
  const adv = await nfl.playerAdvanced(plan.player, year).catch(() => ({ found: false }));
  const cov = tables.playerCoverage(plan.player, year);
  if (!adv.found && !cov) throw userErr(`No data found for "${plan.player}".`);
  const abbr = plan.opponent ? tables.teamAbbr(plan.opponent) : null;
  const pos = plan.position || cov?.pos || adv?.position || "WR";
  const posKey = ["WR", "RB", "TE"].includes(pos) ? pos : "WR";
  return {
    kind: "matchup",
    year,
    player: cov?.name || adv?.player || plan.player,
    position: pos,
    advanced: adv.found ? adv : null,
    playerCoverage: cov,
    opponent: abbr ? { abbr, name: tables.teamName(abbr) } : null,
    defenseVsPos: abbr ? tables.defenseVsPosition(abbr, year)?.pos?.[posKey] || null : null,
    defenseTendencies: abbr ? tables.defenseTendencies(abbr, year) : null,
  };
}

async function gameLogHandler(plan) {
  const log = await nfl.weeklyLog(plan.player, plan.timeframe?.season);
  if (!log.found) throw userErr(`No data for "${plan.player}".`);
  const n = plan.timeframe?.lastN || log.games.length;
  return { kind: "lastN", player: log.player, n, games: log.games.slice(0, n) };
}

async function oddsHandler(plan) {
  const lines = await odds.gameLines();
  return { kind: "odds", market: plan.market || "game lines", games: lines };
}

const HANDLERS = {
  count_games: countGames,
  player_splits: playerSplits,
  player_advanced: playerAdvanced,
  route_profile: routeProfile,
  defense_vs_position: defenseVsPosition,
  defense_tendencies: defenseTendencies,
  matchup,
  game_log: gameLogHandler,
  odds: oddsHandler,
};

export async function handleAsk(question) {
  const plan = await planQuery(question);
  const handler = HANDLERS[plan.intent];
  if (!handler) {
    return { plan, result: { kind: "unsupported", message: plan.explanation || "That's outside what I can answer yet." } };
  }
  const result = await handler(plan);
  return { plan, result };
}
