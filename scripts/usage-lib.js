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

module.exports = {
  TOKEN_METRIC, COST_METRIC, TYPES, SOURCES, MODEL_RE, MACHINE_RE, DATE_RE, MAX_FILE_BYTES, FILE_VERSION,
  emptyState, checkMachine, dayOf, ingest, validateState, firstDay, report, group, usd,
};
