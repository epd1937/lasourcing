/* Gridiron Desk frontend — talk to /api/ask, render each result kind. */

const EXAMPLES = [
  "How many games did Josh Allen throw for 300+ yards?",
  "What's CeeDee Lamb's target share and air yards this season?",
  "Christian McCaffrey's last 5 games",
  "Tyreek Hill vs the Jets matchup",
  "Justin Jefferson advanced stats",
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
      `<span style="color:var(--faint)">${esc(h.model)}</span>`;
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

  matchup(r) {
    const a = r.advanced;
    const c = card(`${esc(a.player)} vs ${esc(r.opponent?.name || "defense")} — ${a.year}`);
    const b = c.querySelector(".body");
    const grid = el("div", "grid2");
    const left = el("div");
    left.appendChild(el("h3", "sec", `${esc(a.player)} usage`));
    left.appendChild(statBlock("", [
      ["Target share", pct(a.receiving.targetShare)], ["Air-yards share", pct(a.receiving.airYardsShare)],
      ["WOPR", a.receiving.wopr], ["Rec yards/g", a.games ? +(a.receiving.yards / a.games).toFixed(1) : null],
      ["Rush yards/g", a.games ? +(a.rushing.yards / a.games).toFixed(1) : null],
      ["PPR/g", a.fantasy.pprPerGame],
    ]));
    grid.appendChild(left);
    const right = el("div");
    right.appendChild(el("h3", "sec", `${esc(r.opponent?.name || "Opponent")} defense`));
    if (r.defense && Object.keys(r.defense.stats).length) {
      const rows = Object.entries(r.defense.stats).slice(0, 12)
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num hi">${esc(v)}</td></tr>`).join("");
      right.appendChild(tableWrap(`<tr><th>Metric</th><th class="num">Value</th></tr>`, rows));
    } else {
      right.appendChild(note(r.opponent ? "ESPN returned no defensive summary for that team/season." : "Name an opponent to pull their defense (e.g. \"vs the Jets\")."));
    }
    grid.appendChild(right);
    b.appendChild(grid);
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
