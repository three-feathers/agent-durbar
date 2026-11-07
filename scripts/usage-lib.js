/*
 * Spec 008 FR-181: the pure parts of the "Build cost" report (scripts/usage-receiver.js, scripts/usage-day.js). Plain Node, built-ins only.
 * Nothing here reads the network or a Claude Code file. What may be kept from an OTLP/HTTP JSON metrics body is decided in ONE place:
 * `ingest` reads the two documented metrics and only these data point attributes: `type`, `model`, `query_source`. Every other attribute
 * (user.email, user.id, session.id, organization.id, agent.name, ...) is never looked at, so it cannot reach a file or the output.
 */
'use strict';

const TOKEN_METRIC = 'claude_code.token.usage';
const COST_METRIC = 'claude_code.cost.usage';
const TYPES = ['input', 'output', 'cacheRead', 'cacheCreation']; // the documented values of the `type` attribute
const SOURCES = ['main', 'subagent', 'auxiliary', 'other']; // `query_source`; anything else is counted as `other`
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/; // a model id; anything else is counted as `other-model`
const MACHINE_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TOKENS_PER_POINT = 1e12;
const MAX_USD_PER_POINT = 1e6;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_VERSION = 1;
const DELTA = 1; // OTLP AggregationTemporality: 1 = delta, 2 = cumulative

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function emptyModel() {
  const bySource = {};
  for (const s of SOURCES) bySource[s] = { tokens: 0, costUsd: 0 };
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0, bySource };
}
function emptyState(machine) { return { version: FILE_VERSION, machine, days: {} }; }

/** The machine label: one the person chose (`DURBAR_USAGE_MACHINE`), never a host name. */
function checkMachine(label) {
  if (typeof label !== 'string' || !MACHINE_RE.test(label)) {
    throw new Error('machine label must be 1-24 letters, digits, "_" or "-" (set DURBAR_USAGE_MACHINE, for example "linux" or "mac")');
  }
  return label.toLowerCase();
}

/** UTC day `YYYY-MM-DD` of a data point's `timeUnixNano` (a string of digits per the OTLP JSON mapping); the receipt time when it is missing or absurd. */
function dayOf(timeUnixNano, nowMs) {
  let ms = nowMs;
  if ((typeof timeUnixNano === 'string' && /^\d{1,20}$/.test(timeUnixNano)) || (typeof timeUnixNano === 'number' && Number.isFinite(timeUnixNano))) {
    const t = Number(timeUnixNano) / 1e6;
    // 2020-01-01 up to two days after now: a clock in the far past or future does not open a new day
    if (Number.isFinite(t) && t >= 1577836800000 && t <= nowMs + 2 * 86400000) ms = t;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** The value of a data point: `asDouble` or `asInt` (a string in proto3 JSON), finite, 0..max; else null. */
function pointValue(dp, max) {
  let v;
  if (own(dp, 'asDouble')) v = dp.asDouble; else if (own(dp, 'asInt')) v = dp.asInt; else return null;
  if (typeof v === 'string') { if (!/^-?\d{1,20}(\.\d{1,20})?$/.test(v)) return null; v = Number(v); }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return null;
  return v;
}

/** `{type, model, source}` from the three allowlisted attributes of a data point; every other attribute is ignored unread. */
function pickAttrs(dp) {
  const out = { type: null, model: null, source: null };
  if (!Array.isArray(dp.attributes)) return out;
  for (const a of dp.attributes) {
    if (!isObj(a) || typeof a.key !== 'string' || !isObj(a.value)) continue;
    const s = a.value.stringValue;
    if (typeof s !== 'string') continue;
    if (a.key === 'type') out.type = s;
    else if (a.key === 'model') out.model = s;
    else if (a.key === 'query_source') out.source = s;
  }
  return out;
}

function modelSlot(state, day, model) {
  if (!own(state.days, day)) state.days[day] = { models: {} };
  const models = state.days[day].models;
  if (!own(models, model)) models[model] = emptyModel();
  return models[model];
}

/**
 * Add the metrics of one OTLP/HTTP JSON body to `state`. `body` is parsed JSON. Only DELTA sums of the two documented metrics count:
 * a cumulative sum cannot be told from a repeat without the session id, which is never kept, so it is skipped and counted.
 * Returns `{tokens, costs, skipped}` (data points added, data points refused).
 */
function ingest(state, body, nowMs = Date.now()) {
  const res = { tokens: 0, costs: 0, skipped: 0 };
  if (!isObj(body) || !Array.isArray(body.resourceMetrics)) throw new Error('not an OTLP metrics body');
  for (const rm of body.resourceMetrics) {
    if (!isObj(rm) || !Array.isArray(rm.scopeMetrics)) continue;
    for (const sm of rm.scopeMetrics) {
      if (!isObj(sm) || !Array.isArray(sm.metrics)) continue;
      for (const m of sm.metrics) {
        if (!isObj(m) || (m.name !== TOKEN_METRIC && m.name !== COST_METRIC) || !isObj(m.sum) || !Array.isArray(m.sum.dataPoints)) continue;
        const temporality = m.sum.aggregationTemporality;
        const isDelta = temporality === DELTA || temporality === 'AGGREGATION_TEMPORALITY_DELTA';
        for (const dp of m.sum.dataPoints) {
          if (!isObj(dp)) { res.skipped++; continue; }
          if (!isDelta) { res.skipped++; continue; }
          const isToken = m.name === TOKEN_METRIC;
          const v = pointValue(dp, isToken ? MAX_TOKENS_PER_POINT : MAX_USD_PER_POINT);
          const a = pickAttrs(dp);
          if (v === null || (isToken && !TYPES.includes(a.type))) { res.skipped++; continue; }
          const model = a.model !== null && MODEL_RE.test(a.model) ? a.model : 'other-model';
          const source = SOURCES.includes(a.source) ? a.source : 'other';
          const slot = modelSlot(state, dayOf(dp.timeUnixNano, nowMs), model);
          if (isToken) { slot[a.type] += v; slot.bySource[source].tokens += v; res.tokens++; }
          else { slot.costUsd += v; slot.bySource[source].costUsd += v; res.costs++; }
        }
      }
    }
  }
  return res;
}

/** A state read from a file, checked field by field and rebuilt from the allowed fields only (extra keys are dropped). Throws on anything else. */
function validateState(raw, where = 'usage file') {
  if (!isObj(raw) || raw.version !== FILE_VERSION || !isObj(raw.days)) throw new Error(`${where}: not a usage file (version ${FILE_VERSION})`);
  const st = emptyState(checkMachine(raw.machine));
  const num = (v) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${where}: a number is wrong`); return v; };
  for (const day of Object.keys(raw.days)) {
    if (!DATE_RE.test(day) || !isObj(raw.days[day]) || !isObj(raw.days[day].models)) throw new Error(`${where}: bad day`);
    for (const model of Object.keys(raw.days[day].models)) {
      const m = raw.days[day].models[model];
      if (!(MODEL_RE.test(model) || model === 'other-model') || !isObj(m)) throw new Error(`${where}: bad model`);
      const slot = modelSlot(st, day, model);
      for (const t of TYPES) slot[t] = num(m[t] === undefined ? 0 : m[t]);
      slot.costUsd = num(m.costUsd === undefined ? 0 : m.costUsd);
      for (const s of SOURCES) {
        const b = isObj(m.bySource) && isObj(m.bySource[s]) ? m.bySource[s] : {};
        slot.bySource[s].tokens = num(b.tokens === undefined ? 0 : b.tokens);
        slot.bySource[s].costUsd = num(b.costUsd === undefined ? 0 : b.costUsd);
      }
    }
  }
  return st;
}

/** The first day with data (`YYYY-MM-DD`) or null. */
function firstDay(state) { const d = Object.keys(state.days).sort(); return d.length ? d[0] : null; }

const sum4 = (m) => m.input + m.output + m.cacheRead + m.cacheCreation;
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // no locale: the same text on every machine
const usd = (n) => '$' + n.toFixed(2);

function emptyTotals() { return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 }; }
function addInto(t, m) { for (const k of Object.keys(t)) t[k] += m[k]; }
function row(label, model, t) {
  return `| ${label} | ${model} | ${group(t.input)} | ${group(t.output)} | ${group(t.cacheRead)} | ${group(t.cacheCreation)} | ${usd(t.costUsd)} |`;
}

/**
 * The markdown report for `date` over `states` (validated). A table per machine and model for the day, the day total, then the
 * cumulative total over every day up to and including `date` ("since tracking began" = the first day of any file).
 */
function report(states, date) {
  if (!DATE_RE.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const lines = [];
  const first = states.map(firstDay).filter(Boolean).sort()[0] || null;
  lines.push(`### Build cost, ${date}`, '', '**API list-price estimate, not billing.** Token counts are what Claude Code reported; dollars are its list-price estimate. '
    + 'Numbers start on the day tracking was switched on' + (first ? ` (first day with data: ${first})` : '') + '.', '');
  lines.push('| Machine | Model | Input | Output | Cache read | Cache write | USD (list price) |', '|---|---|---:|---:|---:|---:|---:|');
  const dayT = emptyTotals();
  const sorted = [...states].sort((a, b) => (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0));
  let any = false;
  for (const st of sorted) {
    const models = own(st.days, date) ? st.days[date].models : {};
    for (const model of Object.keys(models).sort()) {
      const m = models[model];
      if (sum4(m) === 0 && m.costUsd === 0) continue;
      lines.push(row(st.machine, model, m)); addInto(dayT, m); any = true;
    }
  }
  if (!any) lines.push('| (no usage recorded) | | 0 | 0 | 0 | 0 | $0.00 |');
  lines.push(row('**Day total**', '', dayT));
  const cum = emptyTotals();
  for (const st of states) for (const day of Object.keys(st.days)) if (day <= date) for (const model of Object.keys(st.days[day].models)) addInto(cum, st.days[day].models[model]);
  lines.push(row(`**Total since tracking began${first ? ' (' + first + ')' : ''}, to ${date}**`, '', cum), '');
  const mainSub = { main: 0, subagent: 0, auxiliary: 0, other: 0 };
  for (const st of states) if (own(st.days, date)) for (const model of Object.keys(st.days[date].models)) {
    for (const s of SOURCES) mainSub[s] += st.days[date].models[model].bySource[s].costUsd;
  }
  lines.push(`Day cost by source (list price): main ${usd(mainSub.main)}, subagent ${usd(mainSub.subagent)}, auxiliary ${usd(mainSub.auxiliary)}, other ${usd(mainSub.other)}.`, '');
  lines.push(`Machines: ${sorted.map((s) => s.machine).join(', ') || 'none'}. Tools that send no telemetry (another agent app) are added by hand: a usage file of the same shape with its own machine label (docs/build-cost.md).`);
  return lines.join('\n') + '\n';
}

// ---- the README block (FR-181, owner addition 2026-11-07) ----
const BEGIN = '<!-- build-cost:begin (written by `npm run usage:readme`; method in docs/build-cost.md) -->';
const END = '<!-- build-cost:end -->';
const LABEL = 'API list-price estimate, not billing';
/** Model id (what the telemetry sends) -> display name: the one place. An id not listed shows as itself. */
const MODEL_NAMES = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5' };
const modelName = (id) => (own(MODEL_NAMES, id) ? MODEL_NAMES[id] : id);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:\[\]()+-]{0,79}$/; // a display name in the baseline

/** The baseline file (committed, written by hand): what was spent before the receivers ran, or on machines and teams that are not tracked. */
function validateBaseline(raw) {
  if (!isObj(raw) || raw.version !== 1 || !DATE_RE.test(raw.since) || !DATE_RE.test(raw.through) || typeof raw.note !== 'string' || raw.note.length > 600) throw new Error('baseline: not a baseline file');
  const usdOf = (v) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error('baseline: a dollar amount is wrong'); return v; };
  const out = { since: raw.since, through: raw.through, note: raw.note, models: {}, machines: {} };
  for (const k of ['models', 'machines']) {
    if (!isObj(raw[k])) throw new Error(`baseline: ${k} missing`);
    for (const name of Object.keys(raw[k])) {
      if (!NAME_RE.test(name)) throw new Error(`baseline: bad name in ${k}`);
      out[k][name] = usdOf(raw[k][name]);
    }
  }
  return out;
}

/** Cumulative list-price dollars to `date`: the baseline (through its own day) plus every usage-file day after `baseline.through` up to `date`. */
function cumulative(states, date, baseline) {
  const models = new Map(); const machines = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const [k, v] of Object.entries(baseline.models)) add(models, k, v);
  for (const [k, v] of Object.entries(baseline.machines)) add(machines, k, v);
  for (const st of states) for (const day of Object.keys(st.days)) {
    if (day <= baseline.through || day > date) continue;
    for (const model of Object.keys(st.days[day].models)) { const c = st.days[day].models[model].costUsd; add(models, model, c); add(machines, st.machine, c); }
  }
  let total = 0; for (const v of models.values()) total += v;
  return { total, models, machines, since: baseline.since };
}

function split(map, total, labelOf = (k) => k) {
  return [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${labelOf(k)} ${total > 0 ? Math.round((v / total) * 100) : 0}% (US$${group(v)})`).join(', ');
}

/** The README block, markers included. `release` is a tag such as `v0.1.12` (checked). Same inputs, same text. */
function readmeBlock(cum, date, release, note) {
  if (!DATE_RE.test(date)) throw new Error('--date must be YYYY-MM-DD');
  if (!/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release)) throw new Error('--release must look like v0.1.12');
  return [BEGIN, '## Build cost so far', '',
    `**About US$${group(cum.total)}** at API list prices to build this app with AI agents, as of ${date} (release [\`${release}\`](https://github.com/three-feathers/agent-durbar/releases/tag/${release})), tracked since ${cum.since}. `
    + `This is an **${LABEL}**: Claude Code's own list-price figure, not what anyone was charged. Method and privacy: [docs/build-cost.md](docs/build-cost.md).`, '',
    '![Cumulative build cost by model over releases (API list-price estimate, not billing)](docs/build-cost.svg)', '',
    `- By model: ${split(cum.models, cum.total, modelName) || 'none yet'}.`,
    `- By machine or team: ${split(cum.machines, cum.total) || 'none yet'}.`,
    `- Not counted yet: ${note}`, END].join('\n');
}

/** `text` with the block between the markers replaced; exactly one begin line and one end line, in that order, or it throws and changes nothing. */
function rewriteReadme(text, block) {
  const count = (needle) => text.split(needle).length - 1;
  const b = text.indexOf('<!-- build-cost:begin'); const e = text.indexOf(END);
  if (count('<!-- build-cost:begin') !== 1 || count(END) !== 1 || b < 0 || e < b) {
    throw new Error('README needs exactly one "<!-- build-cost:begin ... -->" line followed by one "<!-- build-cost:end -->" line');
  }
  return text.slice(0, b) + block + text.slice(e + END.length);
}

// ---- history, badge and chart (FR-181, owner addition 2026-11-07): plain SVG text, no network, no external service ----
const VERSION_RE = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const f1 = (n) => n.toFixed(1);

/** `docs/build-cost-history.json`: `{version:1, rows:[{date, version, models:{name:usd}, machines:{name:usd}}]}`, cumulative per row, oldest first. */
function validateHistory(raw) {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.rows) || raw.rows.length > 2000) throw new Error('history: not a history file');
  const rows = raw.rows.map((r) => {
    if (!isObj(r) || !DATE_RE.test(r.date) || !VERSION_RE.test(r.version)) throw new Error('history: a row needs date and version');
    const row = { date: r.date, version: r.version, models: {}, machines: {} };
    for (const k of ['models', 'machines']) {
      if (!isObj(r[k])) throw new Error(`history: ${k} missing`);
      for (const name of Object.keys(r[k])) {
        const v = r[k][name];
        if (!NAME_RE.test(name) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error(`history: bad entry in ${k}`);
        row[k][name] = v;
      }
    }
    return row;
  });
  for (let i = 1; i < rows.length; i++) if (rows[i].date < rows[i - 1].date) throw new Error('history: rows must be oldest first');
  return { version: 1, rows };
}

/** Add today's row (the same version replaces its row), keep the order. */
function upsertRow(history, cum, date, release) {
  const row = { date, version: release, models: {}, machines: {} };
  for (const [k, v] of cum.models) row.models[k] = Math.round(v * 100) / 100;
  for (const [k, v] of cum.machines) row.machines[k] = Math.round(v * 100) / 100;
  const rows = history.rows.filter((r) => r.version !== release).concat([row]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.version < b.version ? -1 : 1));
  return { version: 1, rows };
}

const rowTotal = (r) => Object.values(r.models).reduce((a, b) => a + b, 0);

/** The badge: a grey label and a blue value with white text, so it reads on a light and on a dark page. Width from the text length (no font measuring: same bytes everywhere). */
function badgeSvg(total) {
  const left = 'build cost'; const right = `≈ US$${group(total)} (list-price est.)`;
  const lw = Math.round(left.length * 6.2 + 14); const rw = Math.round(right.length * 6.2 + 14); const w = lw + rw;
  const label = `${left}: ${right}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`
    + `<rect width="${lw}" height="20" rx="3" fill="#555"/><rect x="${lw}" width="${rw}" height="20" rx="3" fill="#0969da"/><rect x="${lw}" width="4" height="20" fill="#0969da"/>`
    + `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${f1(lw / 2)}" y="14">${esc(left)}</text><text x="${f1(lw + rw / 2)}" y="14">${esc(right)}</text></g></svg>\n`;
}

const SERIES_COLORS = ['#0969da', '#bf8700', '#1a7f37', '#cf222e', '#8250df', '#6e7781']; // light pages
const SERIES_DARK = ['#388bfd', '#d29922', '#3fb950', '#f85149', '#a371f7', '#8b949e']; // dark pages: lighter, 3:1 or more on #0d1117
const seriesCss = () => SERIES_COLORS.map((c, i) => `.s${i}{fill:${c}}`).join('') + '@media (prefers-color-scheme:dark){' + SERIES_DARK.map((c, i) => `.s${i}{fill:${c}}`).join('') + '}';

/** Cumulative spend by model, stacked areas over release dates (time-proportional x). Zero rows: a note. One row: stacked bars at one date. */
function chartSvg(history) {
  const W = 640; const H = 240; const L = 62; const R = 46; const T = 14; const B = 66; const pw = W - L - R; const ph = H - T - B;
  const rows = history.rows;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"`;
  const style = '<style>text{fill:#1f2328;font:11px Verdana,DejaVu Sans,sans-serif;font-variant-numeric:tabular-nums}.ax{stroke:#8c959f;stroke-width:1}.gr{stroke:#8c959f;stroke-opacity:.35;stroke-width:1}'
    + '@media (prefers-color-scheme:dark){text{fill:#e6edf3}}' + seriesCss() + '</style>';
  if (!rows.length) {
    const t = `Build cost over time (${LABEL}): no releases recorded yet`;
    return `${head} aria-label="${esc(t)}"><title>${esc(t)}</title>${style}<text x="${W / 2}" y="${H / 2}" text-anchor="middle">${esc(t)}</text></svg>\n`;
  }
  const last = rows[rows.length - 1];
  const names = [];
  for (const r of rows) for (const n of Object.keys(r.models)) if (!names.includes(n)) names.push(n);
  names.sort((a, b) => (last.models[b] || 0) - (last.models[a] || 0) || (a < b ? -1 : 1));
  const shown = names.slice(0, SERIES_COLORS.length - 1); const rest = names.slice(SERIES_COLORS.length - 1);
  const series = shown.map((n, i) => ({ name: n, vals: rows.map((r) => r.models[n] || 0), cls: `s${i}` }));
  if (rest.length) series.push({ name: 'other', cls: `s${SERIES_COLORS.length - 1}`, vals: rows.map((r) => rest.reduce((a, n) => a + (r.models[n] || 0), 0)) });
  const top = Math.max(...rows.map(rowTotal), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(top))); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= top);
  const ymax = step * Math.ceil(top / step);
  const y = (v) => T + ph - (v / ymax) * ph;
  const t0 = Date.parse(rows[0].date + 'T00:00:00Z'); const t1 = Date.parse(last.date + 'T00:00:00Z');
  const x = (r) => (rows.length < 2 || t1 === t0 ? L + pw / 2 : L + ((Date.parse(r.date + 'T00:00:00Z') - t0) / (t1 - t0)) * pw);
  const out = [];
  const desc = `Cumulative build cost, ${LABEL}: ${rows.map((r) => `${r.date} ${r.version} US$${group(rowTotal(r))}`).join('; ')}`;
  out.push(`${head} aria-label="${esc(desc)}"><title>${esc('Build cost over time (' + LABEL + ')')}</title><desc>${esc(desc)}</desc>${style}`);
  for (let v = 0; v <= ymax + 1e-9; v += step) {
    out.push(`<line class="gr" x1="${L}" y1="${f1(y(v))}" x2="${W - R}" y2="${f1(y(v))}"/><text x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end">US$${group(v)}</text>`);
  }
  const below = new Array(rows.length).fill(0);
  for (const s of series) {
    const lo = below.slice(); const hi = lo.map((b, i) => b + s.vals[i]);
    if (rows.length < 2) {
      const bw = 44; out.push(`<rect x="${f1(x(rows[0]) - bw / 2)}" y="${f1(y(hi[0]))}" width="${bw}" height="${f1(y(lo[0]) - y(hi[0]))}" class="${s.cls}"/>`);
    } else {
      const up = rows.map((r, i) => `${f1(x(r))},${f1(y(hi[i]))}`); const dn = rows.map((r, i) => `${f1(x(r))},${f1(y(lo[i]))}`).reverse();
      out.push(`<polygon points="${up.concat(dn).join(' ')}" class="${s.cls}"/>`);
    }
    for (let i = 0; i < hi.length; i++) below[i] = hi[i];
  }
  out.push(`<line class="ax" x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}"/><line class="ax" x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}"/>`);
  const every = Math.ceil(rows.length / 6);
  rows.forEach((r, i) => { if (i % every === 0 || i === rows.length - 1) out.push(`<text x="${f1(x(r))}" y="${T + ph + 14}" text-anchor="middle">${esc(r.date.slice(5))} ${esc(r.version)}</text>`); });
  out.push(`<text x="${L + pw / 2}" y="${T + ph + 30}" text-anchor="middle">release date, UTC (cumulative US$, ${esc(LABEL)})</text>`);
  let lx = L;
  for (const s of series) {
    const label = `${modelName(s.name)} US$${group(s.vals[s.vals.length - 1])}`;
    out.push(`<rect x="${lx}" y="${H - 20}" width="10" height="10" class="${s.cls}"/><text x="${lx + 14}" y="${H - 11}">${esc(label)}</text>`);
    lx += 14 + Math.round(label.length * 6.6) + 12;
  }
  out.push('</svg>\n');
  return out.join('');
}

module.exports = {
  TOKEN_METRIC, COST_METRIC, TYPES, SOURCES, MODEL_RE, MACHINE_RE, DATE_RE, MAX_FILE_BYTES, FILE_VERSION,
  modelName, MODEL_NAMES, BEGIN, END, LABEL, validateHistory, upsertRow, badgeSvg, chartSvg, esc, validateBaseline, cumulative, readmeBlock, rewriteReadme, emptyState, checkMachine, dayOf, ingest, validateState, firstDay, report, group, usd,
};
