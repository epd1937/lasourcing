// ─────────────────────────────────────────────────────────────────────────
// Baseball Savant  (baseballsavant.mlb.com)  — Statcast pitch-level data
//
// This is the differentiator vs a plain box-score app. Every pitch since 2015
// is here: pitch type, velocity, result, exit velocity, xwOBA. We use the
// Statcast search CSV export and aggregate server-side into:
//   • a pitcher's PITCH MIX (arsenal usage, velo, whiff rate)
//   • a batter's PERFORMANCE BY PITCH TYPE (BA, whiff%, hard-hit, xwOBA)
//
// NOTE: Savant's CSV params are undocumented and occasionally change. The
// query below reflects the long-stable public shape; if a pull returns 0 rows,
// verify params at baseballsavant.mlb.com/statcast_search against a browser
// request. A full season for one player is a few thousand rows — light.
// ─────────────────────────────────────────────────────────────────────────

const BASE = "https://baseballsavant.mlb.com/statcast_search/csv";

// Batted-ball / result classification from the `events` column.
const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const AB_EVENTS = new Set([
  "single", "double", "triple", "home_run", "field_out", "strikeout",
  "grounded_into_double_play", "force_out", "field_error", "fielders_choice",
  "fielders_choice_out", "double_play", "strikeout_double_play", "other_out",
]);

function buildUrl(params) {
  const q = new URLSearchParams({
    all: "true",
    type: "details",
    player_type: params.playerType, // "pitcher" | "batter"
    game_year: String(params.year),
    min_pitches: "0",
    min_results: "0",
    group_by: "name",
    sort_col: "pitches",
    player_event_sort: "api_p_release_speed",
    sort_order: "desc",
  });
  if (params.playerType === "pitcher") q.append("pitchers_lookup[]", params.playerId);
  else q.append("batters_lookup[]", params.playerId);
  return `${BASE}?${q.toString()}`;
}

// Minimal CSV parser (handles quoted fields with commas).
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchPitches(playerType, playerId, year) {
  const url = buildUrl({ playerType, playerId, year });
  const r = await fetch(url, { headers: { "User-Agent": "diamond-desk/0.1" } });
  if (!r.ok) throw new Error(`Savant ${r.status}`);
  return parseCsv(await r.text());
}

const num = (v) => (v === "" || v == null ? null : Number(v));

/* ── Pitcher pitch mix (arsenal) ───────────────────────────────────────── */
export async function pitchMix(pitcherId, year) {
  const pitches = await fetchPitches("pitcher", pitcherId, year);
  if (!pitches.length) return { year, total: 0, arsenal: [] };
  const by = new Map();
  for (const p of pitches) {
    const key = p.pitch_type || "UN";
    if (!by.has(key))
      by.set(key, { code: key, name: p.pitch_name || key, count: 0, veloSum: 0, veloN: 0, swings: 0, whiffs: 0 });
    const g = by.get(key);
    g.count++;
    const v = num(p.release_speed);
    if (v != null) { g.veloSum += v; g.veloN++; }
    const desc = p.description || "";
    const swing = /swing|foul|hit_into_play|missed/.test(desc) && desc !== "foul_bunt";
    if (swing) g.swings++;
    if (desc === "swinging_strike" || desc === "swinging_strike_blocked") g.whiffs++;
  }
  const total = pitches.length;
  const arsenal = [...by.values()]
    .map((g) => ({
      code: g.code,
      name: g.name,
      count: g.count,
      usage: +(100 * g.count / total).toFixed(1),
      avgVelo: g.veloN ? +(g.veloSum / g.veloN).toFixed(1) : null,
      whiffRate: g.swings ? +(100 * g.whiffs / g.swings).toFixed(1) : null,
    }))
    .sort((a, b) => b.count - a.count);
  return { year, total, arsenal };
}

/* ── Batter performance by pitch type ──────────────────────────────────── */
export async function batterVsPitchType(batterId, year) {
  const pitches = await fetchPitches("batter", batterId, year);
  if (!pitches.length) return { year, total: 0, byPitch: [] };
  const by = new Map();
  for (const p of pitches) {
    const key = p.pitch_type || "UN";
    if (!by.has(key))
      by.set(key, {
        code: key, name: p.pitch_name || key, pitches: 0,
        ab: 0, hits: 0, swings: 0, whiffs: 0,
        evSum: 0, evN: 0, hardHit: 0, batted: 0, xwobaSum: 0, xwobaN: 0,
      });
    const g = by.get(key);
    g.pitches++;
    const desc = p.description || "";
    if (/swing|foul|hit_into_play|missed/.test(desc) && desc !== "foul_bunt") g.swings++;
    if (desc === "swinging_strike" || desc === "swinging_strike_blocked") g.whiffs++;
    const ev = num(p.launch_speed);
    if (ev != null) { g.evSum += ev; g.evN++; g.batted++; if (ev >= 95) g.hardHit++; }
    const xw = num(p.estimated_woba_using_speedangle);
    if (xw != null) { g.xwobaSum += xw; g.xwobaN++; }
    const ev_event = p.events || "";
    if (AB_EVENTS.has(ev_event)) g.ab++;
    if (HIT_EVENTS.has(ev_event)) g.hits++;
  }
  const total = pitches.length;
  const byPitch = [...by.values()]
    .map((g) => ({
      code: g.code,
      name: g.name,
      pitches: g.pitches,
      seen: +(100 * g.pitches / total).toFixed(1),
      avg: g.ab ? +(g.hits / g.ab).toFixed(3) : null,
      whiffRate: g.swings ? +(100 * g.whiffs / g.swings).toFixed(1) : null,
      avgExitVelo: g.evN ? +(g.evSum / g.evN).toFixed(1) : null,
      hardHitRate: g.batted ? +(100 * g.hardHit / g.batted).toFixed(1) : null,
      xwoba: g.xwobaN ? +(g.xwobaSum / g.xwobaN).toFixed(3) : null,
    }))
    .sort((a, b) => b.pitches - a.pitches);
  return { year, total, byPitch };
}
