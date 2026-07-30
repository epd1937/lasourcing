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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "web")));

function fail(res, err) {
  const status = err.userFacing ? 400 : err.code === "NO_LLM_KEY" || err.code === "NO_ODDS_KEY" ? 503 : 500;
  res.status(status).json({ error: err.message, code: err.code || null });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    llm: !!process.env.ANTHROPIC_API_KEY,
    odds: !!process.env.ODDS_API_KEY,
    model: process.env.GRIDIRON_MODEL || "claude-opus-5",
  });
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
