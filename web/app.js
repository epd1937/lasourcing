/* Diamond Desk frontend — talk to /api/ask, render each result kind. */

const EXAMPLES = [
  "How many times has Aaron Judge hit 2 home runs in a game?",
  "How does Mookie Betts hit against sliders this season?",
  "Show me Gerrit Cole's pitch mix",
  "Shohei Ohtani's last 10 games",
  "Freddie Freeman vs left-handed pitching in 2024",
  "Aaron Judge vs Tarik Skubal matchup",
  "MLB moneyline odds today",
];

const $ = (s) => document.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const OP = { gte: "≥", gt: ">", eq: "=", lt: "<", lte: "≤" };

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
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    ? " Set <b>ANTHROPIC_API_KEY</b> in your environment to enable the parser."
    : data.code === "NO_ODDS_KEY"
    ? " Set <b>ODDS_API_KEY</b> to enable betting lines."
    : "";
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
  const c = card(`Interpreted as <b>${esc(plan.intent)}</b>`, "");
  c.querySelector(".body").innerHTML =
    `<div class="plan">${esc(plan.explanation || "")}</div>`;
  return c;
}

function card(capText, bodyHtml) {
  const c = el("div", "card");
  c.appendChild(el("div", "cap", `<span>${capText}</span>`));
  const b = el("div", "body", bodyHtml);
  c.appendChild(b);
  return c;
}
function note(t) { return el("div", "note", t); }

const RENDER = {
  count(r) {
    const cond = `${OP[r.operator] || "≥"} ${r.threshold} ${labelStat(r.stat)}`;
    const c = card(`${esc(r.player.name)} — game log scan`, "");
    const b = c.querySelector(".body");
    b.appendChild(el("div", "answer",
      `<div class="big ${r.count === 0 ? "zero" : ""}">${r.count}</div>
       <div class="line"><b>${esc(r.player.name)}</b> has had <b>${cond}</b> in a game
       <b>${r.count === 1 ? "once" : r.count + " times"}</b> (${esc(r.scope)}).</div>`));
    if (r.games.length) b.appendChild(gamesTable(r.games, r.stat));
    return c;
  },

  splits(r) {
    const c = card(`${esc(r.player.name)} — platoon splits, ${r.season}`, "");
    const b = c.querySelector(".body");
    const grid = el("div", "grid2");
    grid.appendChild(splitBlock("vs LHP", r.splits.vsL));
    grid.appendChild(splitBlock("vs RHP", r.splits.vsR));
    b.appendChild(grid);
    return c;
  },

  lastN(r) {
    const c = card(`${esc(r.player.name)} — last ${r.games.length} games`, "");
    c.querySelector(".body").appendChild(gamesTable(r.games, "homeRuns", true));
    return c;
  },

  pitch_profile(r) {
    const c = card(`${esc(r.player.name)} vs pitch type — ${r.year} (Statcast)`, "");
    const b = c.querySelector(".body");
    if (!r.byPitch?.length) { b.appendChild(note("No Statcast rows returned for that season.")); return c; }
    const rows = r.byPitch.map((p) => `<tr>
      <td>${esc(p.name)}</td>
      <td class="num">${p.seen}%</td>
      <td class="num hi">${p.avg ?? "—"}</td>
      <td class="num">${p.xwoba ?? "—"}</td>
      <td class="num">${p.whiffRate ?? "—"}%</td>
      <td class="num">${p.avgExitVelo ?? "—"}</td>
      <td class="num">${p.hardHitRate ?? "—"}%</td></tr>`).join("");
    b.appendChild(tableWrap(
      `<tr><th>Pitch</th><th class="num">Seen</th><th class="num">AVG</th><th class="num">xwOBA</th>
       <th class="num">Whiff%</th><th class="num">Exit velo</th><th class="num">Hard-hit%</th></tr>`, rows));
    return c;
  },

  pitch_mix(r) {
    const c = card(`${esc(r.player.name)} — pitch mix, ${r.year} (Statcast)`, "");
    const b = c.querySelector(".body");
    if (!r.arsenal?.length) { b.appendChild(note("No Statcast rows returned for that season.")); return c; }
    const max = Math.max(...r.arsenal.map((p) => p.usage));
    const rows = r.arsenal.map((p) => `<tr>
      <td>${esc(p.name)}</td>
      <td class="num hi">${p.usage}%</td>
      <td><span class="bar" style="width:${Math.round(90 * p.usage / max)}px"></span></td>
      <td class="num">${p.avgVelo ?? "—"}</td>
      <td class="num">${p.whiffRate ?? "—"}%</td></tr>`).join("");
    b.appendChild(tableWrap(
      `<tr><th>Pitch</th><th class="num">Usage</th><th></th><th class="num">Velo</th><th class="num">Whiff%</th></tr>`, rows));
    return c;
  },

  matchup(r) {
    const c = card(`${esc(r.batter.name)} vs ${esc(r.pitcher.name)} — ${r.year}`, "");
    const b = c.querySelector(".body");
    const grid = el("div", "grid2");
    // Left: batter platoon + how the pitcher's arsenal plays.
    const left = el("div");
    left.appendChild(el("h3", "sec", "Batter platoon"));
    const g = el("div", "grid2");
    g.appendChild(splitBlock("vs LHP", r.splits.vsL));
    g.appendChild(splitBlock("vs RHP", r.splits.vsR));
    left.appendChild(g);
    grid.appendChild(left);
    // Right: pitcher's mix, annotated with how this batter fares vs each pitch.
    const right = el("div");
    right.appendChild(el("h3", "sec", `${esc(r.pitcher.name)}'s arsenal — and how ${esc(r.batter.name)} handles it`));
    const perf = new Map((r.batterProfile || []).map((p) => [p.code, p]));
    const rows = (r.pitcherMix || []).map((m) => {
      const p = perf.get(m.code);
      return `<tr><td>${esc(m.name)}</td><td class="num hi">${m.usage}%</td>
        <td class="num">${m.avgVelo ?? "—"}</td>
        <td class="num">${p?.avg ?? "—"}</td>
        <td class="num">${p?.whiffRate ?? "—"}%</td></tr>`;
    }).join("");
    right.appendChild(tableWrap(
      `<tr><th>Pitch</th><th class="num">Usage</th><th class="num">Velo</th>
       <th class="num">B AVG</th><th class="num">B Whiff%</th></tr>`,
      rows || `<tr><td colspan="5">No Statcast overlap.</td></tr>`));
    grid.appendChild(right);
    b.appendChild(grid);
    return c;
  },

  odds(r) {
    const c = card(`Betting lines — ${esc(r.market)}`, "");
    const b = c.querySelector(".body");
    if (!r.games?.length) { b.appendChild(note("No games returned. The book calendar may be empty right now.")); return c; }
    for (const g of r.games.slice(0, 12)) {
      const time = new Date(g.commence).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
      const wrap = el("div", "", `<div style="margin:14px 0 6px;font-weight:600">${esc(g.away)} @ ${esc(g.home)}
        <span style="color:var(--faint);font-weight:400">· ${esc(time)}</span></div>`);
      const rows = g.books.slice(0, 6).map((bk) => {
        const ml = (bk.markets.h2h || []);
        const away = ml.find((o) => o.name === g.away)?.price;
        const home = ml.find((o) => o.name === g.home)?.price;
        const tot = (bk.markets.totals || [])[0];
        return `<tr><td>${esc(bk.book)}</td>
          <td class="num">${fmtOdds(away)}</td><td class="num">${fmtOdds(home)}</td>
          <td class="num">${tot ? esc(tot.point) : "—"}</td></tr>`;
      }).join("");
      wrap.appendChild(tableWrap(
        `<tr><th>Book</th><th class="num">${esc(g.away)}</th><th class="num">${esc(g.home)}</th><th class="num">Total</th></tr>`, rows));
      b.appendChild(wrap);
    }
    return c;
  },

  unsupported(r) { return note(esc(r.message)); },
};

/* ── shared bits ───────────────────────────────────────────────────────── */
function labelStat(s) {
  return ({ homeRuns: "home runs", rbi: "RBIs", baseOnBalls: "walks", stolenBases: "stolen bases",
    totalBases: "total bases", strikeOuts: "strikeouts", atBats: "at-bats" }[s]) || s;
}
function gamesTable(games, stat, showAll) {
  const rows = games.map((g) => `<tr>
    <td class="num">${esc(g.date)}</td>
    <td>${g.isHome ? "vs" : "@"} ${esc(g.opponent)}</td>
    <td class="num hi">${g.stats[stat] ?? 0}</td>
    <td class="num">${line(g.stats)}</td></tr>`).join("");
  return tableWrap(
    `<tr><th class="num">Date</th><th>Opp</th><th class="num">${labelStat(stat)}</th><th class="num">AB/H/HR/RBI</th></tr>`, rows);
}
function line(s) { return `${s.atBats ?? "–"}/${s.hits ?? "–"}/${s.homeRuns ?? "–"}/${s.rbi ?? "–"}`; }
function splitBlock(title, st) {
  if (!st) return el("div", "note", `${title}: no data`);
  const d = el("div", "note");
  d.innerHTML = `<div style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em">${title}</div>
    <div style="margin-top:6px;font-size:14px">
      <b style="color:var(--accent)">${st.avg ?? "—"}</b>/${st.obp ?? "—"}/${st.slg ?? "—"}
      <span style="color:var(--faint)"> · ${st.homeRuns ?? 0} HR, ${st.rbi ?? 0} RBI in ${st.atBats ?? 0} AB</span></div>`;
  return d;
}
function tableWrap(head, rows) {
  const w = el("div", "scroll");
  w.innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  return w;
}
function fmtOdds(p) { return p == null ? "—" : p > 0 ? `+${p}` : `${p}`; }

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
