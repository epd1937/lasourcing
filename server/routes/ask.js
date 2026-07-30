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

// matchup: player usage/efficiency + opponent defense summary.
async function matchup(plan) {
  const [adv, oppTeam] = await Promise.all([
    nfl.playerAdvanced(plan.player, plan.timeframe?.season),
    plan.opponent ? espn.resolveTeam(plan.opponent) : Promise.resolve(null),
  ]);
  if (!adv.found) throw userErr(`No nflverse data found for "${plan.player}".`);
  let defense = null;
  if (oppTeam) defense = await espn.teamDefense(oppTeam.id, plan.timeframe?.season).catch(() => null);
  return { kind: "matchup", advanced: adv, opponent: oppTeam, defense };
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
