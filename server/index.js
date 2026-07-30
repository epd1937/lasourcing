// ─────────────────────────────────────────────────────────────────────────
// Gridiron Desk server. Serves the web UI and the JSON API.
//   GET  /api/health
//   POST /api/ask                       { question }   → { plan, result }
//   GET  /api/odds                                     → NFL game lines
//   GET  /api/odds/:eventId/props                      → player props for a game
//   GET  /api/advanced/:name?year=YYYY                 → a player's advanced usage
//   GET  /api/gamelog/:name?year=YYYY                  → weekly game log
// ─────────────────────────────────────────────────────────────────────────

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleAsk } from "./routes/ask.js";
import * as nfl from "./sources/nflverse.js";
import * as odds from "./sources/odds.js";
import * as tables from "./sources/tables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "web")));

function fail(res, err) {
  const soft = ["NO_LLM_KEY", "NO_ODDS_KEY", "NOT_INGESTED"].includes(err.code);
  const status = err.userFacing ? 400 : soft ? 503 : 500;
  res.status(status).json({ error: err.message, code: err.code || null });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    llm: !!process.env.ANTHROPIC_API_KEY,
    odds: !!process.env.ODDS_API_KEY,
    model: process.env.GRIDIRON_MODEL || "claude-opus-5",
    ingestedSeason: tables.latestSeason(),
  });
});

// Defense matchup table for one team (position grades + tendencies).
app.get("/api/defense/:team", (req, res) => {
  try {
    const abbr = tables.teamAbbr(req.params.team);
    if (!abbr) return res.status(404).json({ error: `Unknown team "${req.params.team}".` });
    const year = parseInt(req.query.year, 10) || undefined;
    res.json({
      team: abbr,
      name: tables.teamName(abbr),
      vsPosition: tables.defenseVsPosition(abbr, year),
      tendencies: tables.defenseTendencies(abbr, year),
    });
  } catch (err) {
    fail(res, err);
  }
});

// Defense leaderboard: teams ranked by a stat allowed to a position.
app.get("/api/defense-leaderboard", (req, res) => {
  try {
    const pos = (req.query.position || "WR").toUpperCase();
    const metric = req.query.metric || (pos === "RB" ? "rushYdsPerGame" : "recYdsPerGame");
    res.json(tables.defenseLeaderboard(pos, metric, parseInt(req.query.year, 10) || undefined));
  } catch (err) {
    fail(res, err);
  }
});

// A receiver's route tree + man/zone coverage splits.
app.get("/api/routes/:name", (req, res) => {
  try {
    const cov = tables.playerCoverage(req.params.name, parseInt(req.query.year, 10) || undefined);
    if (!cov) return res.status(404).json({ error: `No route data for "${req.params.name}".` });
    res.json(cov);
  } catch (err) {
    fail(res, err);
  }
});

app.post("/api/ask", async (req, res) => {
  const question = (req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "Ask a question." });
  try {
    res.json(await handleAsk(question));
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/odds", async (_req, res) => {
  try {
    res.json({ games: await odds.gameLines() });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/odds/:eventId/props", async (req, res) => {
  try {
    res.json(await odds.playerProps(req.params.eventId));
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/advanced/:name", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || undefined;
    const data = await nfl.playerAdvanced(req.params.name, year);
    if (!data.found) return res.status(404).json({ error: `No nflverse data for "${req.params.name}".` });
    res.json(data);
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/gamelog/:name", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || undefined;
    const data = await nfl.weeklyLog(req.params.name, year);
    if (!data.found) return res.status(404).json({ error: `No game log for "${req.params.name}".` });
    res.json(data);
  } catch (err) {
    fail(res, err);
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`Gridiron Desk → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("  ⚠ ANTHROPIC_API_KEY unset — /api/ask disabled until you set it.");
  if (!process.env.ODDS_API_KEY) console.log("  ⚠ ODDS_API_KEY unset — betting lines disabled until you set it.");
});
