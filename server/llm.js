// ─────────────────────────────────────────────────────────────────────────
// The query brain: English → structured query plan, via Claude.
//
// This is what makes it "ask anything". Instead of regex, Claude reads the
// question and returns a validated JSON plan (structured outputs guarantee the
// shape). The plan routes to the right data source(s) in routes/ask.js.
//
// Uses the official Anthropic SDK with output_config.format (JSON schema).
// Model defaults to claude-opus-5; override with DIAMOND_MODEL.
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

// The plan shape. `intent` decides which handler runs; the rest are the knobs.
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "count_games",     // "how many times has X had N+ <stat>"
        "player_splits",   // vs LHP/RHP, home/away, last-N situational lines
        "pitch_profile",   // batter's performance by pitch type (Statcast)
        "pitch_mix",       // a pitcher's arsenal / usage (Statcast)
        "matchup",         // batter vs a given pitcher — betting-relevant blend
        "game_log",        // recent game-by-game log
        "odds",            // betting lines / props across books
        "unsupported",
      ],
    },
    player: { type: ["string", "null"], description: "Batter or primary player full name." },
    pitcher: { type: ["string", "null"], description: "Pitcher full name, for matchups/pitch mix." },
    team: { type: ["string", "null"] },
    group: { type: "string", enum: ["hitting", "pitching"] },
    stat: {
      type: ["string", "null"],
      description:
        "camelCase StatsAPI field: homeRuns, hits, rbi, doubles, triples, stolenBases, baseOnBalls, runs, totalBases, strikeOuts, atBats.",
    },
    operator: { type: ["string", "null"], enum: ["gte", "gt", "eq", "lt", "lte", null] },
    threshold: { type: ["number", "null"] },
    handedness: { type: ["string", "null"], enum: ["L", "R", null], description: "Opposing pitcher hand (vs LHP=L, vs RHP=R)." },
    pitchType: { type: ["string", "null"], description: "Pitch type name or code, e.g. slider/SL, four-seam/FF." },
    timeframe: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["career", "season", "lastN", "month", "postseason"] },
        season: { type: ["number", "null"] },
        lastN: { type: ["number", "null"] },
        month: { type: ["number", "null"], description: "1-12 when a month is named." },
      },
      required: ["type", "season", "lastN", "month"],
    },
    market: { type: ["string", "null"], description: "For odds: moneyline, spread, total, home_runs, hits, strikeouts, …" },
    explanation: { type: "string", description: "One sentence restating the interpreted question." },
  },
  required: [
    "intent", "player", "pitcher", "team", "group", "stat", "operator",
    "threshold", "handedness", "pitchType", "timeframe", "market", "explanation",
  ],
};

const SYSTEM = `You translate natural-language MLB questions into a structured query plan for a baseball betting/stats research tool. Today is ${new Date().toISOString().slice(0, 10)}.

Pick the single best intent:
- count_games: "how many times has <batter> had <N>+ <stat>" (threshold questions over game logs). Default operator to "gte" for "N" or "N+" phrasing; use "eq" only when the user says "exactly".
- player_splits: performance vs LHP/RHP, home/away, or "over the last N" situational lines. Set handedness L/R when the user asks vs lefties/righties.
- pitch_profile: how a BATTER performs against pitch types (vs sliders, vs fastballs, whiff rates, exit velo).
- pitch_mix: a PITCHER's arsenal and usage (what does <pitcher> throw / pitch mix).
- matchup: a batter facing a specific pitcher — blend of splits + pitch profile vs that pitcher's mix. Set both player and pitcher.
- game_log: recent game-by-game results.
- odds: betting lines, moneyline, spreads, totals, or player props.
- unsupported: anything out of scope; still explain why.

Resolve relative dates against today. "this season" -> current year season; "last 10" -> timeframe.type=lastN, lastN=10. Name the month number when a month is given. Always fill every field (use null where not applicable) and write a one-sentence explanation of your interpretation.`;

export async function planQuery(question) {
  const c = client();
  const model = process.env.DIAMOND_MODEL || "claude-opus-5";
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
