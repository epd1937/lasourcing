/* Gridiron Desk frontend — talk to /api/ask, render each result kind. */

const EXAMPLES = [
  "CeeDee Lamb vs the Lions matchup",
  "How does the 49ers defense handle tight ends?",
  "Which defense allows the most receiving yards to WRs?",
  "How much man coverage do the Ravens play?",
  "What routes does Justin Jefferson run, and how's he do vs man?",
  "How many games did Josh Allen throw for 300+ yards?",
  "NFL spreads and totals this week",
];

const $ = (s) => document.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OP = { gte: "≥", gt: ">", eq: "=", lt: "<", lte: "≤" };
const n0 = (v) => (v == null ? "—" : v);

async function health() {
  try {
    const h = await (await fetch("/api/health")).json();
    $("#status-chip").innerHTML =
      `LLM <span class="${h.llm ? "on" : "off"}">${h.llm ? "●" : "○"}</span> ` +
      `odds <span class="${h.odds ? "on" : "off"}">${h.odds ? "●" : "○"}</span> ` +
      `<span style="color:var(--faint)">${h.ingestedSeason ? h.ingestedSeason + " data · " : ""}${esc(h.model)}</span>`;
  } catch { $("#status-chip").textContent = "server offline"; }
}

async function ask() {
  const question = $("#q").value.trim();
  if (!question) return;
  const go = $("#go");
  go.disabled = true;
  $("#result").innerHTML = "";
  $("#status").innerHTML = '<span class="spin"></span>Reading the question…';
  try {
    const res = await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    $("#status").innerHTML = "";
    if (!res.ok) return showError(data);
    render(data);
  } catch (e) {
    $("#status").innerHTML = "";
    showError({ error: e.message });
  } finally {
    go.disabled = false;
  }
}

function showError(data) {
  const hint = data.code === "NO_LLM_KEY"
    ? " Set <b>ANTHROPIC_API_KEY</b> to enable the parser."
    : data.code === "NO_ODDS_KEY" ? " Set <b>ODDS_API_KEY</b> to enable betting lines." : "";
  $("#result").innerHTML = `<div class="err"><b>Couldn't answer that.</b> ${esc(data.error || "Unknown error.")}${hint}</div>`;
}

/* ── render dispatch ───────────────────────────────────────────────────── */
function render({ plan, result }) {
  const root = $("#result");
  root.appendChild(planCard(plan));
  const r = result || {};
  const fn = RENDER[r.kind] || (() => note(r.message || "Nothing to show."));
  root.appendChild(fn(r));
}
function planCard(plan) {
  const c = card(`Interpreted as <b>${esc(plan.intent)}</b>`);
  c.querySelector(".body").innerHTML = `<div class="plan">${esc(plan.explanation || "")}</div>`;
  return c;
}
function card(capText, bodyHtml) {
  const c = el("div", "card");
  c.appendChild(el("div", "cap", `<span>${capText}</span>`));
  c.appendChild(el("div", "body", bodyHtml || ""));
  return c;
}
function note(t) { return el("div", "note", t); }

const RENDER = {
  count(r) {
    const cond = `${OP[r.operator] || "≥"} ${r.threshold} ${esc(r.statLabel)}`;
    const c = card(`${esc(r.player)} — weekly game-log scan`);
    const b = c.querySelector(".body");
    b.appendChild(el("div", "answer",
      `<div class="big ${r.count === 0 ? "zero" : ""}">${r.count}</div>
       <div class="line"><b>${esc(r.player)}</b> has gone <b>${cond}</b> in a game
       <b>${r.count === 1 ? "once" : r.count + " times"}</b> (${esc(r.scope)}).</div>`));
    if (r.games.length) b.appendChild(gamesTable(r.games, r.column, r.statLabel));
    return c;
  },

  lastN(r) {
    const c = card(`${esc(r.player)} — last ${r.games.length} games`);
    c.querySelector(".body").appendChild(gamesTable(r.games, null, null));
    return c;
  },

  advanced(r) {
    const c = card(`${esc(r.player)} — advanced usage & efficiency, ${r.year}`);
    const b = c.querySelector(".body");
    b.appendChild(el("div", "plan",
      `${esc(r.position || "")} · ${esc(r.team || "")} · ${r.games} games · <b>${n0(r.fantasy.pprPerGame)}</b> PPR/g`));
    const grid = el("div", "grid2");
    grid.appendChild(statBlock("Receiving", [
      ["Targets", r.receiving.targets], ["Receptions", r.receiving.receptions],
      ["Rec yards", r.receiving.yards], ["Rec TDs", r.receiving.tds],
      ["Target share", pct(r.receiving.targetShare)], ["Air-yards share", pct(r.receiving.airYardsShare)],
      ["aDOT", r.receiving.aDOT], ["WOPR", r.receiving.wopr],
      ["Catch rate", pct(r.receiving.catchRate)], ["Rec EPA", r.receiving.epa],
    ]));
    grid.appendChild(statBlock("Passing / Rushing", [
      ["Pass yards", r.passing.yards], ["Pass TDs", r.passing.tds], ["INTs", r.passing.ints],
      ["Pass EPA", r.passing.epa], ["Pass EPA/g", r.passing.epaPerGame],
      ["Rush yards", r.rushing.yards], ["Carries", r.rushing.carries],
      ["Rush TDs", r.rushing.tds], ["Rush EPA", r.rushing.epa],
    ]));
    b.appendChild(grid);
    b.appendChild(note("Target share, air-yards share and WOPR are the usage signals that most directly drive receiving props."));
    return c;
  },

  splits(r) {
    const c = card(`${esc(r.player.name)} — situational splits, ${r.season}`);
    const b = c.querySelector(".body");
    if (!r.splits?.length) { b.appendChild(note("No splits returned by ESPN for that player/season.")); return c; }
    const labels = r.labels || [];
    const rows = r.splits.slice(0, 14).map((s) => `<tr>
      <td>${esc(s.category ? s.category + " · " : "")}${esc(s.name)}</td>
      ${labels.slice(0, 6).map((l) => `<td class="num">${esc(s.stats[l] ?? "—")}</td>`).join("")}</tr>`).join("");
    b.appendChild(tableWrap(
      `<tr><th>Split</th>${labels.slice(0, 6).map((l) => `<th class="num">${esc(l)}</th>`).join("")}</tr>`, rows));
    return c;
  },

  route_profile(r) {
    const c = card(`${esc(r.name)} — route tree & coverage splits, ${r.year}`);
    const b = c.querySelector(".body");
    const grid = el("div", "grid2");
    grid.appendChild(coverageSplit("vs MAN", r.vsMan));
    grid.appendChild(coverageSplit("vs ZONE", r.vsZone));
    b.appendChild(grid);
    b.appendChild(el("h3", "sec", "Route distribution (when targeted)"));
    b.appendChild(routeBars(r.routes));
    return c;
  },

  defense_vs_position_team(r) {
    const c = card(`${esc(r.teamName)} defense vs ${esc(r.position)} — ${r.year}`);
    const b = c.querySelector(".body");
    if (!r.row) { b.appendChild(note(`No ${r.position} data for that defense.`)); return c; }
    const isRb = r.position === "RB";
    const primary = isRb ? r.row.rushYdsPerGame : r.row.recYdsPerGame;
    const rank = r.row.ranks?.[isRb ? "rushYdsPerGame" : "recYdsPerGame"];
    b.appendChild(el("div", "answer",
      `<div class="big">${primary}</div>
       <div class="line"><b>${isRb ? "rush" : "receiving"} yards/game</b> allowed to ${esc(r.position)}s
       ${rank ? `· <b>${ordinal(rank)}-most</b> in the NFL (rank ${rank}/32)` : ""}</div>`));
    b.appendChild(statBlock("", [
      ["Rec yds/g allowed", r.row.recYdsPerGame], ["Rec TD/g", r.row.recTdPerGame],
      ["Catch% allowed", pct(r.row.catchRate)], ["Targets/g", r.row.targetsPerGame],
      ["Rush yds/g allowed", r.row.rushYdsPerGame], ["Rush TD/g", r.row.rushTdPerGame],
    ]));
    if (r.tendencies) { b.appendChild(el("h3", "sec", "Coverage scheme")); b.appendChild(tendencyBlock(r.tendencies)); }
    return c;
  },

  defense_leaderboard(r) {
    const c = card(`Defenses ranked — ${labelMetric(r.metric)} allowed to ${esc(r.position)}s, ${r.year}`);
    const b = c.querySelector(".body");
    const max = Math.max(...r.rows.map((x) => x.value));
    const rows = r.rows.map((x, i) => `<tr>
      <td class="num">${i + 1}</td><td>${esc(x.name)}</td>
      <td class="num hi">${x.value}</td>
      <td><span class="bar" style="width:${Math.round(120 * x.value / max)}px"></span></td></tr>`).join("");
    b.appendChild(tableWrap(`<tr><th class="num">#</th><th>Defense</th><th class="num">${labelMetric(r.metric)}</th><th></th></tr>`, rows));
    b.appendChild(note("Rank 1 = most allowed (softest matchup). Grades derived from every play, joined to receiver/rusher positions."));
    return c;
  },

  defense_tendencies(r) {
    const c = card(`${esc(r.teamName)} defense — scheme & coverage, ${r.year}`);
    c.querySelector(".body").appendChild(tendencyBlock(r.tendencies, true));
    return c;
  },

  matchup(r) {
    const c = card(`${esc(r.player)} (${esc(r.position)}) vs ${esc(r.opponent?.name || "defense")} — ${r.year}`);
    const b = c.querySelector(".body");
    const grid = el("div", "grid2");

    const left = el("div");
    left.appendChild(el("h3", "sec", `${esc(r.player)} — usage`));
    if (r.advanced) left.appendChild(statBlock("", [
      ["Target share", pct(r.advanced.receiving.targetShare)],
      ["Air-yards share", pct(r.advanced.receiving.airYardsShare)],
      ["WOPR", r.advanced.receiving.wopr],
      ["Rec yds/g", r.advanced.games ? +(r.advanced.receiving.yards / r.advanced.games).toFixed(1) : null],
    ]));
    if (r.playerCoverage) {
      const g = el("div", "grid2");
      g.appendChild(coverageSplit("vs MAN", r.playerCoverage.vsMan));
      g.appendChild(coverageSplit("vs ZONE", r.playerCoverage.vsZone));
      left.appendChild(g);
    }
    grid.appendChild(left);

    const right = el("div");
    if (!r.opponent) {
      right.appendChild(note('Name an opponent to overlay the defense (e.g. "vs the Jets").'));
    } else {
      right.appendChild(el("h3", "sec", `${esc(r.opponent.name)} defense`));
      if (r.defenseVsPos) {
        const isRb = r.position === "RB";
        const rank = r.defenseVsPos.ranks?.[isRb ? "rushYdsPerGame" : "recYdsPerGame"];
        right.appendChild(statBlock(`vs ${esc(r.position)}`, [
          ["Rec yds/g allowed", r.defenseVsPos.recYdsPerGame],
          ["Catch% allowed", pct(r.defenseVsPos.catchRate)],
          ["Rush yds/g allowed", r.defenseVsPos.rushYdsPerGame],
          ["Matchup rank", rank ? `${ordinal(rank)}-softest` : null],
        ]));
      }
      if (r.defenseTendencies) right.appendChild(tendencyBlock(r.defenseTendencies));
    }
    grid.appendChild(right);
    b.appendChild(grid);
    b.appendChild(note("The edge: a high-target-share receiver who thrives vs zone, facing a zone-heavy defense that's soft to his position, is the setup you're hunting."));
    return c;
  },

  odds(r) {
    const c = card(`Betting lines — ${esc(r.market)}`);
    const b = c.querySelector(".body");
    if (!r.games?.length) { b.appendChild(note("No games returned — the book calendar may be empty right now.")); return c; }
    for (const g of r.games.slice(0, 14)) {
      const time = new Date(g.commence).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
      const wrap = el("div", "", `<div style="margin:14px 0 6px;font-weight:600">${esc(g.away)} @ ${esc(g.home)}
        <span style="color:var(--faint);font-weight:400">· ${esc(time)}</span></div>`);
      const rows = g.books.slice(0, 6).map((bk) => {
        const spreads = bk.markets.spreads || [];
        const away = spreads.find((o) => o.name === g.away);
        const home = spreads.find((o) => o.name === g.home);
        const ml = bk.markets.h2h || [];
        const mlA = ml.find((o) => o.name === g.away)?.price;
        const tot = (bk.markets.totals || [])[0];
        return `<tr><td>${esc(bk.book)}</td>
          <td class="num">${away ? fmtPt(away.point) : "—"}</td>
          <td class="num">${home ? fmtPt(home.point) : "—"}</td>
          <td class="num">${fmtOdds(mlA)}</td>
          <td class="num">${tot ? esc(tot.point) : "—"}</td></tr>`;
      }).join("");
      wrap.appendChild(tableWrap(
        `<tr><th>Book</th><th class="num">${esc(g.away)} sprd</th><th class="num">${esc(g.home)} sprd</th>
         <th class="num">${esc(g.away)} ML</th><th class="num">Total</th></tr>`, rows));
      b.appendChild(wrap);
    }
    return c;
  },

  unsupported(r) { return note(esc(r.message)); },
};

/* ── shared bits ───────────────────────────────────────────────────────── */
const STAT_LABEL = {
  passing_yards: "Pass yds", passing_tds: "Pass TD", interceptions: "INT", completions: "Cmp",
  rushing_yards: "Rush yds", rushing_tds: "Rush TD", carries: "Car",
  receiving_yards: "Rec yds", receptions: "Rec", targets: "Tgt", receiving_tds: "Rec TD",
};
function weekLine(st) {
  const parts = [];
  if (st.passing_yards) parts.push(`${st.completions || 0}/${st.attempts || 0}, ${st.passing_yards} pass, ${st.passing_tds || 0} TD`);
  if (st.carries) parts.push(`${st.carries} car, ${st.rushing_yards || 0} rush`);
  if (st.targets) parts.push(`${st.receptions || 0}/${st.targets} tgt, ${st.receiving_yards || 0} rec`);
  return parts.join(" · ") || "—";
}
function gamesTable(games, column, statLabel) {
  const rows = games.map((g) => `<tr>
    <td class="num">${g.season ?? ""} W${g.week ?? "—"}</td>
    <td>vs ${esc(g.opponent || "—")}</td>
    ${column ? `<td class="num hi">${g.stats[column] ?? 0}</td>` : ""}
    <td class="num">${weekLine(g.stats)}</td></tr>`).join("");
  return tableWrap(
    `<tr><th class="num">Wk</th><th>Opp</th>${column ? `<th class="num">${esc(statLabel)}</th>` : ""}<th class="num">Line</th></tr>`, rows);
}
function statBlock(title, pairs) {
  const d = el("div", "note");
  const head = title ? `<div style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${esc(title)}</div>` : "";
  d.innerHTML = head + `<table style="font-size:13px">${pairs.map(([k, v]) =>
    `<tr><td style="border:0;padding:3px 0;color:var(--muted)">${esc(k)}</td>
     <td class="num" style="border:0;padding:3px 0"><b>${n0(v)}</b></td></tr>`).join("")}</table>`;
  return d;
}
function tableWrap(head, rows) {
  const w = el("div", "scroll");
  w.innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  return w;
}
const pct = (v) => (v == null ? null : `${v}%`);
const fmtOdds = (p) => (p == null ? "—" : p > 0 ? `+${p}` : `${p}`);
const fmtPt = (p) => (p == null ? "—" : p > 0 ? `+${p}` : `${p}`);
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const labelMetric = (m) => ({ recYdsPerGame: "rec yds/g", rushYdsPerGame: "rush yds/g" }[m] || m);
const COVER = { COVER_0: "Cover 0", COVER_1: "Cover 1", COVER_2: "Cover 2", COVER_3: "Cover 3", COVER_4: "Cover 4", COVER_6: "Cover 6", "2_MAN": "2-Man", COVER_9: "Cover 9", COMBO: "Combo", PREVENT: "Prevent" };

function coverageSplit(title, s) {
  const d = el("div", "note");
  if (!s) { d.innerHTML = `<div style="color:var(--muted);font-size:12px">${esc(title)}: no data</div>`; return d; }
  d.innerHTML = `<div style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em">${esc(title)}</div>
    <div style="margin-top:6px;font-size:14px"><b style="color:var(--accent)">${s.catchRate}%</b> catch
    · <b>${s.ydsPerTarget}</b> yds/tgt <span style="color:var(--faint)">(${s.targets} tgt)</span></div>`;
  return d;
}
function routeBars(routes) {
  if (!routes?.length) return note("No route data.");
  const max = Math.max(...routes.map((r) => r.pct));
  const rows = routes.map((r) => `<tr>
    <td>${esc(r.route)}</td><td class="num hi">${r.pct}%</td>
    <td><span class="bar" style="width:${Math.round(110 * r.pct / max)}px"></span></td></tr>`).join("");
  return tableWrap(`<tr><th>Route</th><th class="num">Share</th><th></th></tr>`, rows);
}
function tendencyBlock(t, full) {
  const d = el("div");
  d.appendChild(statBlock("", [
    ["Man coverage", pct(t.manRate)], ["Zone coverage", pct(t.zoneRate)],
    ["Blitz rate", pct(t.blitzRate)], ["Pressure rate", pct(t.pressureRate)],
    ["Avg box", t.avgBox],
  ]));
  const cov = Object.entries(t.coverage || {}).sort((a, b) => b[1] - a[1]).slice(0, full ? 10 : 5);
  if (cov.length) {
    const max = Math.max(...cov.map(([, v]) => v));
    const rows = cov.map(([k, v]) => `<tr><td>${esc(COVER[k] || k)}</td><td class="num hi">${v}%</td>
      <td><span class="bar" style="width:${Math.round(100 * v / max)}px"></span></td></tr>`).join("");
    d.appendChild(el("h3", "sec", "Coverage shells"));
    d.appendChild(tableWrap(`<tr><th>Shell</th><th class="num">Rate</th><th></th></tr>`, rows));
  }
  return d;
}

/* ── wire up ───────────────────────────────────────────────────────────── */
const chips = $("#chips");
EXAMPLES.forEach((ex) => {
  const c = el("div", "chip", esc(ex));
  c.onclick = () => { $("#q").value = ex; ask(); };
  chips.appendChild(c);
});
$("#go").onclick = ask;
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
health();
