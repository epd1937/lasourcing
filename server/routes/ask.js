// ─────────────────────────────────────────────────────────────────────────
// /api/ask  — the front door. Parse the question, run the matching handler,
// return { plan, result }. Each result carries a `kind` the frontend renders.
// ─────────────────────────────────────────────────────────────────────────

import { planQuery } from "../llm.js";
import * as mlb from "../sources/statsapi.js";
import * as savant from "../sources/savant.js";
import * as odds from "../sources/odds.js";

const now = () => new Date().getFullYear();

function passes(v, op, t) {
  v = Number(v || 0);
  switch (op) {
    case "gt": return v > t;
    case "eq": return v === t;
    case "lt": return v < t;
    case "lte": return v <= t;
    default: return v >= t; // gte
  }
}

// count_games: threshold questions over per-game logs, with optional month
// filter and single-season vs career scope. Handles regular season +
// postseason via timeframe.type === "postseason".
async function countGames(plan) {
  const player = await mlb.resolvePlayer(plan.player);
  if (!player) throw userErr(`No player found named "${plan.player}".`);
  const group = plan.group || "hitting";
  const stat = plan.stat || "homeRuns";
  const op = plan.operator || "gte";
  const t = plan.threshold ?? 1;

  const tf = plan.timeframe || { type: "career" };
  const postseason = tf.type === "postseason";
  const gameTypes = postseason ? ["D", "L", "W", "F", "P"] : ["R"];
  const seasons = tf.type === "season" && tf.season
    ? [tf.season]
    : await mlb.playerSeasons(player.id, group);

  const all = await mlb.gameLogsAcross(player.id, seasons, group, gameTypes);
  const matches = all.filter((g) => {
    if (!passes(g.stats[stat], op, t)) return false;
    if (tf.type === "month" && tf.month) {
      if (parseInt(g.date.slice(5, 7), 10) !== tf.month) return false;
    }
    return true;
  });
  return {
    kind: "count",
    player,
    stat,
    operator: op,
    threshold: t,
    scope: tf.type === "season" ? `${tf.season}` : postseason ? "postseason (career)" : "career",
    count: matches.length,
    games: matches.slice(0, 200),
  };
}

async function playerSplits(plan) {
  const player = await mlb.resolvePlayer(plan.player);
  if (!player) throw userErr(`No player found named "${plan.player}".`);
  const group = plan.group || "hitting";
  const tf = plan.timeframe || { type: "season" };

  if (tf.type === "lastN") {
    const games = await mlb.lastNGames(player.id, tf.lastN || 10, group);
    return { kind: "lastN", player, n: tf.lastN || 10, games };
  }
  const season = tf.season || now();
  const splits = await mlb.splitsVsHand(player.id, season, group);
  return { kind: "splits", player, season, handedness: plan.handedness || null, splits };
}

async function pitchProfile(plan) {
  const player = await mlb.resolvePlayer(plan.player);
  if (!player) throw userErr(`No player found named "${plan.player}".`);
  const year = plan.timeframe?.season || now();
  const data = await savant.batterVsPitchType(player.id, year);
  return { kind: "pitch_profile", player, ...data, pitchType: plan.pitchType || null };
}

async function pitchMix(plan) {
  const name = plan.pitcher || plan.player;
  const player = await mlb.resolvePlayer(name);
  if (!player) throw userErr(`No pitcher found named "${name}".`);
  const year = plan.timeframe?.season || now();
  const data = await savant.pitchMix(player.id, year);
  return { kind: "pitch_mix", player, ...data };
}

// matchup: the money view — batter's L/R splits + pitch profile against the
// pitcher's actual arsenal, side by side.
async function matchup(plan) {
  const [batter, pitcher] = await Promise.all([
    mlb.resolvePlayer(plan.player),
    mlb.resolvePlayer(plan.pitcher),
  ]);
  if (!batter) throw userErr(`No batter found named "${plan.player}".`);
  if (!pitcher) throw userErr(`No pitcher found named "${plan.pitcher}".`);
  const year = plan.timeframe?.season || now();
  const [splits, profile, mix] = await Promise.all([
    mlb.splitsVsHand(batter.id, year, "hitting").catch(() => ({ vsL: null, vsR: null })),
    savant.batterVsPitchType(batter.id, year).catch(() => ({ byPitch: [] })),
    savant.pitchMix(pitcher.id, year).catch(() => ({ arsenal: [] })),
  ]);
  return { kind: "matchup", batter, pitcher, year, splits, batterProfile: profile.byPitch, pitcherMix: mix.arsenal };
}

async function gameLogHandler(plan) {
  const player = await mlb.resolvePlayer(plan.player);
  if (!player) throw userErr(`No player found named "${plan.player}".`);
  const n = plan.timeframe?.lastN || 15;
  const games = await mlb.lastNGames(player.id, n, plan.group || "hitting");
  return { kind: "lastN", player, n, games };
}

async function oddsHandler(plan) {
  const lines = await odds.gameLines();
  return { kind: "odds", market: plan.market || "game lines", games: lines };
}

function userErr(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  return e;
}

const HANDLERS = {
  count_games: countGames,
  player_splits: playerSplits,
  pitch_profile: pitchProfile,
  pitch_mix: pitchMix,
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
