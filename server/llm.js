// ─────────────────────────────────────────────────────────────────────────
// The query brain: English → structured query plan, via Claude.
//
// This is what makes it "ask anything". Claude reads the question and returns
// a validated JSON plan (structured outputs guarantee the shape). The plan
// routes to the right data source(s) in routes/ask.js.
//
// Uses the official Anthropic SDK with output_config.format (JSON schema).
// Model defaults to claude-opus-5; override with GRIDIRON_MODEL.
// ─────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error("ANTHROPIC_API_KEY not set — the question parser is unavailable.");
    e.code = "NO_LLM_KEY";
    throw e;
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "count_games",         // "how many times has X thrown for 300+ yards"
        "player_splits",       // home/away, vs division, situational lines
        "player_advanced",     // EPA, target share, air yards, WOPR (nflverse)
        "route_profile",       // a receiver's route tree + man/zone splits
        "defense_vs_position", // how a defense (or the league) handles WR/RB/TE
        "defense_tendencies",  // a defense's man/zone rate, coverage shells, blitz
        "matchup",             // player vs an opposing defense — the full blend
        "game_log",            // recent game-by-game
        "odds",                // lines / props across books
        "unsupported",
      ],
    },
    player: { type: ["string", "null"], description: "Primary player full name." },
    opponent: { type: ["string", "null"], description: "Opposing team (name, city, or nickname) for matchups." },
    team: { type: ["string", "null"] },
    stat: {
      type: ["string", "null"],
      description:
        "Stat label for count/game-log questions: passing yards, passing TDs, rushing yards, rushing TDs, receptions, receiving yards, receiving TDs, interceptions, completions, targets.",
    },
    operator: { type: ["string", "null"], enum: ["gte", "gt", "eq", "lt", "lte", null] },
    threshold: { type: ["number", "null"] },
    phase: { type: ["string", "null"], enum: ["passing", "rushing", "receiving", null], description: "Which stat family the question is about." },
    position: { type: ["string", "null"], enum: ["WR", "RB", "TE", "QB", null], description: "Position for defense-vs-position questions." },
    timeframe: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["career", "season", "lastN", "week"] },
        season: { type: ["number", "null"] },
        lastN: { type: ["number", "null"] },
        week: { type: ["number", "null"] },
      },
      required: ["type", "season", "lastN", "week"],
    },
    market: { type: ["string", "null"], description: "For odds: moneyline, spread, total, pass_yds, rush_yds, receptions, anytime_td, …" },
    explanation: { type: "string", description: "One sentence restating the interpreted question." },
  },
  required: [
    "intent", "player", "opponent", "team", "stat", "operator", "threshold",
    "phase", "position", "timeframe", "market", "explanation",
  ],
};

const SYSTEM = `You translate natural-language NFL questions into a structured query plan for a football betting/stats research tool. Today is ${new Date().toISOString().slice(0, 10)}.

Pick the single best intent:
- count_games: threshold questions over game logs ("how many games did <player> go over 100 rushing yards"). Default operator to "gte" for "N+" phrasing; use "eq" only when the user says "exactly". Set the stat to the plain stat name and the phase to passing/rushing/receiving.
- player_splits: home/away, vs division, or "over the last N" situational lines.
- player_advanced: usage and efficiency — target share, air yards, EPA, WOPR, aDOT, catch rate. Use this for "how involved is X", "X's target share", "X advanced stats".
- route_profile: a receiver's route tree and how they perform vs man vs zone coverage ("what routes does X run", "X vs man coverage").
- defense_vs_position: how a defense handles a position, or a league leaderboard ("how do the Jets defend tight ends", "which defense allows the most receiving yards to WRs"). Set the team (or opponent) and the position (WR/RB/TE).
- defense_tendencies: a defense's scheme — man vs zone rate, coverage shells (Cover 0–6), blitz and pressure rate ("how much man coverage do the Ravens play"). Set team.
- matchup: a player facing a specific defense. Set both player and opponent — blends the player's usage and route/coverage splits with how that defense performs vs the player's position and its coverage tendencies.
- game_log: recent game-by-game results.
- odds: betting lines, spreads, totals, moneyline, or player props (passing/rushing/receiving yards, receptions, anytime TD).
- unsupported: out of scope; still explain why.

Resolve relative dates against today. "this season" -> current season year; "last 5" -> timeframe.type=lastN, lastN=5. Always fill every field (null where not applicable) and write a one-sentence explanation of your interpretation.`;

export async function planQuery(question) {
  const c = client();
  const model = process.env.GRIDIRON_MODEL || "claude-opus-5";
  const resp = await c.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: PLAN_SCHEMA },
    },
    messages: [{ role: "user", content: question }],
  });
  const text = resp.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}
