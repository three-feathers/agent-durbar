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
const MAX_MODELS_PER_DAY = 50; // distinct model ids per day; the rest are added to `other-model`, so one process cannot grow the file
const FILE_VERSION = 1;
const SCOPE = 'agent-durbar'; // every file declares it counted Agent Durbar work only (owner, 2026-11-08)
const REPO_ATTR = 'vcs.repository.url.full'; // Claude Code adds it with OTEL_METRICS_INCLUDE_REPOSITORY=true (v2.1.269+); read only to compare, never kept
const DEFAULT_REPOS = ['https://github.com/three-feathers/agent-durbar'];
const SEG_RE = /^[a-z0-9._-]{1,100}$/i; // ASCII only: a homoglyph (Cyrillic "а" for "a") never matches
const HOST_RE = /^[a-z0-9.-]{1,100}$/i;
const USERINFO = "(?:[A-Za-z0-9._~%!$&'()*+,;=:-]*@)?"; // RFC 3986 userinfo: unreserved, sub-delims, pct-encoded, ':'; never '/', '#', '?', '\\' or '@'
/**
 * One spelling for a repository: `https://<host>/<owner>/<repo>`, lowercase, from https://, ssh://, git:// and scp-style (`git@host:owner/repo`) remotes,
 * with any `user[:token]@`, port, `.git` and trailing slash removed. Exactly two path segments or null. The input is never kept or echoed (it may hold a token).
 */
function normalizeRepo(text) {
  /*NORM*/
  if (typeof text !== 'string' || text.length > 300) return null;
  const s = text.trim();
  /*REJECT*/ if (/[\s#?\\\u0000-\u001f\u007f-\u009f]/.test(s)) return null; // a '#', '?', '\\' or control character would let a URL parser read another host than this regex does
  const isUrl = /^(?:https|ssh|git):\/\//i.test(s);
  let m = new RegExp(`^(?:https|ssh|git):\\/\\/${USERINFO}([^\\/:@]+)(?::\\d{1,5})?\\/(.+)$`, 'i').exec(s);
  if (!m) m = /^(?:[A-Za-z0-9._~%!$&'()*+,;=-]+@)?([^\/:@]+):(?!\/)(.+)$/.exec(s);
  if (!m) return null;
  if (isUrl) { let h = null; try { h = new URL(s).hostname; } catch { return null; } if (h.toLowerCase() !== m[1].toLowerCase()) return null; } // a real URL parser must read the same host
  const parts = m[2].replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 2 || !HOST_RE.test(m[1]) || !parts.every((x) => SEG_RE.test(x))) return null;
  return `https://${m[1]}/${parts[0]}/${parts[1]}`.toLowerCase();
}
/** The allowed repository URLs: `DURBAR_USAGE_REPOS` (comma-separated, lowercase https URLs without `.git`) or the default. Throws on a malformed entry. */
function parseRepos(text) {
  if (text === undefined || text === '') return DEFAULT_REPOS.slice();
  const list = String(text).split(',').map((x) => x.trim()).filter(Boolean).map(normalizeRepo); // an entry is never echoed in an error (it may hold a token)
  if (!list.length || list.some((u) => u === null)) throw new Error('DURBAR_USAGE_REPOS must be comma-separated repository URLs (https://, ssh:// or git@host:owner/repo), e.g. https://github.com/three-feathers/agent-durbar');
  return list;
}
const DELTA = 1; // OTLP AggregationTemporality: 1 = delta, 2 = cumulative

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function emptyModel() {
  const bySource = {};
  for (const s of SOURCES) bySource[s] = { tokens: 0, costUsd: 0 };
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0, bySource };
}
function emptyState(machine) { return { version: FILE_VERSION, machine, scope: SCOPE, skipped: 0, days: {} }; }

/** The machine label: one the person chose (`DURBAR_USAGE_MACHINE`), never a host name. */
function checkMachine(label) {
  if (typeof label !== 'string' || !MACHINE_RE.test(label)) {
    throw new Error('machine label must be 1-24 letters, digits, "_" or "-" (set DURBAR_USAGE_MACHINE, for example "linux" or "mac")');
  }
  return label.toLowerCase();
}

// A data point's time must be inside [now - 2 days, now + 5 minutes]: an exporter reports "now", so an older or later point is
// made up or a broken clock, and is dropped (counted). Without this a local process could open one day after another.
const PAST_WINDOW_MS = 2 * 86400000;
const FUTURE_SLACK_MS = 5 * 60000;
const MAX_DAYS_PER_REQUEST = 4; // the window spans at most four UTC dates
const MAX_DAYS_PER_FILE = 1500; // about four years of days

/** UTC day `YYYY-MM-DD` of a data point's `timeUnixNano` (a string of digits per the OTLP JSON mapping); the receipt time when it is missing or not a number; null when it is outside the window above. */
function dayOf(timeUnixNano, nowMs) {
  let ms = nowMs;
  if ((typeof timeUnixNano === 'string' && /^\d{1,20}$/.test(timeUnixNano)) || (typeof timeUnixNano === 'number' && Number.isFinite(timeUnixNano))) {
    const t = Number(timeUnixNano) / 1e6;
    if (!Number.isFinite(t) || t < nowMs - PAST_WINDOW_MS || t > nowMs + FUTURE_SLACK_MS) return null;
    ms = t;
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

/** `{type, model, source, repo}` from the allowlisted attributes of a data point (`repo` is only compared, never stored); every other attribute is ignored unread. */
function pickAttrs(dp) {
  const out = { type: null, model: null, source: null, repo: null };
  if (!Array.isArray(dp.attributes)) return out;
  for (const a of dp.attributes) {
    if (!isObj(a) || (a.key !== 'type' && a.key !== 'model' && a.key !== 'query_source' && a.key !== REPO_ATTR)) continue; // the key is checked before the value is touched
    if (!isObj(a.value) || typeof a.value.stringValue !== 'string') continue;
    if (a.key === REPO_ATTR) out.repo = normalizeRepo(a.value.stringValue); // canonical form or null; the original text is dropped here
    else if (a.key === 'type') out.type = a.value.stringValue;
    else if (a.key === 'model') out.model = a.value.stringValue;
    else out.source = a.value.stringValue;
  }
  return out;
}

function modelSlot(state, day, model, capped = true) {
  if (!own(state.days, day)) state.days[day] = { models: {} };
  const models = state.days[day].models;
  if (capped && !own(models, model) && Object.keys(models).length >= MAX_MODELS_PER_DAY) model = 'other-model';
  if (!own(models, model)) models[model] = emptyModel();
  return models[model];
}

/**
 * Add the metrics of one OTLP/HTTP JSON body to `state`. `body` is parsed JSON. Only DELTA sums of the two documented metrics count:
 * a cumulative sum cannot be told from a repeat without the session id, which is never kept, so it is skipped and counted.
 * Returns `{tokens, costs, skipped}` (data points added, data points refused).
 */
function ingest(state, body, nowMs = Date.now(), repos = null) {
  const res = { tokens: 0, costs: 0, skipped: 0, otherWork: 0 }; // otherWork: points of another repository or with no repository, dropped unrecorded (not an error)
  const seenDays = new Set();
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
          if (repos && !(a.repo !== null && repos.includes(a.repo))) { res.otherWork++; continue; } // only Agent Durbar work; no repository attribute = not provably Durbar = dropped
          if (v === null || (isToken && !TYPES.includes(a.type))) { res.skipped++; continue; }
          const model = a.model !== null && MODEL_RE.test(a.model) ? a.model : 'other-model';
          const source = SOURCES.includes(a.source) ? a.source : 'other';
          const day = dayOf(dp.timeUnixNano, nowMs);
          if (day === null || (!seenDays.has(day) && (seenDays.size >= MAX_DAYS_PER_REQUEST || (!own(state.days, day) && Object.keys(state.days).length >= MAX_DAYS_PER_FILE)))) { res.skipped++; continue; }
          seenDays.add(day);
          const slot = modelSlot(state, day, model);
          if (isToken) { slot[a.type] += v; slot.bySource[source].tokens += v; res.tokens++; }
          else { slot.costUsd += v; slot.bySource[source].costUsd += v; res.costs++; }
        }
      }
    }
  }
  state.skipped += res.skipped;
  return res;
}

/** A state read from a file, checked field by field and rebuilt from the allowed fields only (extra keys are dropped). Throws on anything else. */
function validateState(raw, where = 'usage file', opts = {}) {
  if (!isObj(raw) || raw.version !== FILE_VERSION || !isObj(raw.days)) throw new Error(`${where}: not a usage file (version ${FILE_VERSION})`);
  if (opts.requireScope ? raw.scope !== SCOPE : (raw.scope !== undefined && raw.scope !== SCOPE)) throw new Error(`${where}: scope must be "${SCOPE}" (this machine counted Agent Durbar work only)`);
  const st = emptyState(checkMachine(raw.machine));
  const num = (v) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${where}: a number is wrong`); return v; };
  for (const day of Object.keys(raw.days)) {
    if (!DATE_RE.test(day) || !isObj(raw.days[day]) || !isObj(raw.days[day].models)) throw new Error(`${where}: bad day`);
    for (const model of Object.keys(raw.days[day].models)) {
      const m = raw.days[day].models[model];
      if (!(MODEL_RE.test(model) || model === 'other-model') || !isObj(m)) throw new Error(`${where}: bad model`);
      const slot = modelSlot(st, day, model, false);
      for (const t of TYPES) slot[t] = num(m[t] === undefined ? 0 : m[t]);
      slot.costUsd = num(m.costUsd === undefined ? 0 : m.costUsd);
      for (const s of SOURCES) {
        const b = isObj(m.bySource) && isObj(m.bySource[s]) ? m.bySource[s] : {};
        slot.bySource[s].tokens = num(b.tokens === undefined ? 0 : b.tokens);
        slot.bySource[s].costUsd = num(b.costUsd === undefined ? 0 : b.costUsd);
      }
    }
  }
  st.skipped = raw.skipped === undefined ? 0 : num(raw.skipped);
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
  const dropped = states.reduce((a, st) => a + st.skipped, 0);
  lines.push(dropped > 0 ? `**Dropped data points: ${group(dropped)}** (cumulative temporality or invalid values; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta, see docs/build-cost.md). Totals above leave them out.` : 'Dropped data points: 0.', '');
  lines.push(`Machines: ${sorted.map((s) => s.machine).join(', ') || 'none'}. Tools that send no telemetry (another agent app) are added by hand: a usage file of the same shape with its own machine label (docs/build-cost.md).`);
  return lines.join('\n') + '\n';
}

// ---- the README block (FR-181, owner addition 2026-11-07) ----
const BEGIN = '<!-- build-cost:begin (written by `npm run usage:readme`; method in docs/build-cost.md) -->';
const END = '<!-- build-cost:end -->';
const LABEL = 'API list-price estimate, not billing';
/** Model id (what the telemetry sends) -> display name: the one place. An id not listed shows as itself. */
const MODEL_NAMES = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
// an id not listed above: `claude-<family>-<major>-<minor>` reads as "Family major.minor"; anything else shows as itself
const modelName = (id) => {
  if (own(MODEL_NAMES, id)) return MODEL_NAMES[id];
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
};
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
  const models = new Map(); const machines = new Map(); const firstDays = new Map();
  // whole cents per machine/day/model, as the daily chart (usage-spread dailyRows) counts them, so the chart and the total agree exactly (FR-198)
  const addC = (m, k, c) => m.set(k, (m.get(k) || 0) + c);
  const add = (m, k, v) => addC(m, k, Math.round(v * 100));
  for (const [k, v] of Object.entries(baseline.models)) add(models, k, v);
  for (const [k, v] of Object.entries(baseline.machines)) { add(machines, k, v); if (Math.round(v * 100) > 0) firstDays.set(k, baseline.since); }
  for (const st of states) for (const day of Object.keys(st.days)) {
    // a machine with its own baseline entry is counted after the baseline's day; one without (a teammate's machine) from its first day
    if ((own(baseline.machines, st.machine) && day <= baseline.through) || day > date) continue;
    for (const model of Object.keys(st.days[day].models)) { const c = st.days[day].models[model].costUsd; add(models, model, c); add(machines, st.machine, c); if (Math.round(c * 100) > 0 && !(firstDays.get(st.machine) <= day)) firstDays.set(st.machine, day); }
  }
  let totalC = 0; for (const v of models.values()) totalC += v;
  const back = (m) => new Map([...m].map(([k, c]) => [k, c / 100]));
  return { total: totalC / 100, totalCents: totalC, models: back(models), machines: back(machines), firstDays, since: baseline.since };
}

function split(map, total, labelOf = (k) => k) {
  return [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${labelOf(k)} ${total > 0 ? Math.round((v / total) * 100) : 0}% (US$${group(v)})`).join(', ');
}

/** The day each machine with spend began, grouped: `first` is the earliest day of all (the baseline's `since`, or earlier when a usage file starts before it) and `groups` is [date, machines starting that day] in date order. */
function machineStarts(cum) {
  const days = [...(cum.firstDays || new Map())].filter(([m]) => (cum.machines.get(m) || 0) > 0).map(([, d]) => d);
  const counts = new Map(); for (const d of days) counts.set(d, (counts.get(d) || 0) + 1);
  const groups = [...counts].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return { first: groups.length ? groups[0][0] : cum.since, groups };
}

/** The scope facts in the README sentence, all computed from the data (never typed): machine count, since date, spread share (`estUsd` = the estimated, spread part of the total). */
const scopeClause = (cum, estUsd) => {
  const n = [...cum.machines.values()].filter((v) => v > 0).length;
  const share = cum.total > 0 ? estUsd / cum.total : 0;
  const how = share <= 0 ? 'all measured' : share > 0.5 ? 'mostly spread over earlier days rather than measured' : `${Math.round(share * 100)}% spread over earlier days rather than measured`;
  // when each machine's spend began (computed from the data, never typed): say so, never imply every machine covers the whole period
  const { first, groups } = machineStarts(cum);
  const word = (k) => ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][k - 1] || String(k);
  const when = groups.length < 2 ? ` since ${first}` : `: ${groups.map(([d, k], i) => `${word(k)} ${i === 0 ? 'since' : 'from'} ${d}`).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `work on ${n === 1 ? 'one machine' : `${n} machines`}${when}, ${how}`;
};

/** The README block, markers included: one short paragraph and, when there is a spread, the daily graph (owner decisions 2026-11-08; the details live in docs/build-cost.md). `release` is a tag such as `v0.1.12` (checked). Same inputs, same text. */
function readmeBlock(cum, date, release, withDaily = false, estUsd = 0) {
  if (!DATE_RE.test(date)) throw new Error('--date must be YYYY-MM-DD');
  if (!/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release)) throw new Error('--release must look like v0.1.12');
  return [BEGIN, '## Build cost so far', '',
    `**About US$${group(cum.total)}** at API list prices to build this app with AI agents, as of ${date} (release [\`${release}\`](https://github.com/three-feathers/agent-durbar/releases/tag/${release})): an **${LABEL}** of ${scopeClause(cum, estUsd)}. `
    + `The rest is not counted yet; the split, the spread of the earlier days and the method: [docs/build-cost.md](docs/build-cost.md).`, '',
    ...(withDaily ? ['![Daily build cost by model: measured days solid, estimated (spread) days faded and dashed](docs/build-cost-days.svg)', ''] : []),
    END].join('\n').replace(/\n\n<!-- build-cost:end -->$/, '\n' + END);
}

const DETAIL_BEGIN = '<!-- build-cost-detail:begin (written by `npm run usage:readme`) -->';
const DETAIL_END = '<!-- build-cost-detail:end -->';
/** The detail section of docs/build-cost.md, markers included: both graphs, the spread note, the by-model and by-machine lines, what is not counted. */
function detailBlock(cum, date, release, note, spreadNote) {
  return [DETAIL_BEGIN, '## The numbers so far', '',
    `**About US$${group(cum.total)}** (${LABEL}), tracked since ${machineStarts(cum).first}, as of ${date} (release \`${release}\`).`, '',
    '![Cumulative build cost by model over releases (API list-price estimate, not billing)](build-cost.svg)', '',
    '![Daily build cost by model: measured days solid, estimated (spread) days faded and dashed](build-cost-days.svg)', '',
    ...(spreadNote ? [spreadNote, ''] : []),
    `- By model: ${split(cum.models, cum.total, modelName) || 'none yet'}.`,
    `- By machine or team: ${split(cum.machines, cum.total) || 'none yet'}.`,
    `- Not counted yet: ${note}`, DETAIL_END].join('\n');
}

/** `text` with the block between two marker lines replaced; exactly one of each, in order, or it throws and changes nothing. */
function rewriteBetween(text, begin, end, block, what) {
  const count = (needle) => text.split(needle).length - 1;
  const b = text.indexOf(begin); const e = text.indexOf(end);
  if (count(begin) !== 1 || count(end) !== 1 || b < 0 || e < b) throw new Error(`${what} needs exactly one "${begin}... -->" line followed by one "${end}" line`);
  const eol = text.includes('\r\n') ? block.replace(/\r?\n/g, '\r\n') : block; // a file checked out with CRLF keeps one line ending
  return text.slice(0, b) + eol + text.slice(e + end.length);
}
const rewriteDetail = (text, block) => rewriteBetween(text, '<!-- build-cost-detail:begin', DETAIL_END, block, 'docs/build-cost.md');

/** The README badge's alt text, from the same total as the block (issue #1351). */
const badgeAlt = (total) => `Build cost, about US$${group(total)} at API list prices (estimate, not billing)`;
const BADGE_RE = /(<img src="docs\/build-cost-badge\.svg" alt=")[^"]*(")/;
function rewriteBadgeAlt(text, total) {
  if ((text.match(new RegExp(BADGE_RE.source, 'g')) || []).length !== 1) throw new Error('README needs exactly one build-cost badge image (docs/build-cost-badge.svg)');
  return text.replace(BADGE_RE, (m, a, z) => a + badgeAlt(total) + z);
}

/** `text` with the block between the markers replaced; exactly one begin line and one end line, in that order, or it throws and changes nothing. */
function rewriteReadme(text, block) {
  return rewriteBetween(text, '<!-- build-cost:begin', END, block, 'README');
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

const DAY_SPREAD_LINE = (est, n, since, through) => `Estimated, not measured: US$${group(est)} of the total, spent before telemetry could count it per day, is spread over ${n} days (${since} to ${through}) by 50% lines changed and 50% merged PRs of each day (git history); the faded, dashed bars are those estimates, the solid bars are measured. Per-model split of an estimated day: the same mix as the original lump (an assumption).`;

/** Daily spend, stacked by model: measured part solid, estimated (spread) part faded with a dashed outline. `rows` from usage-spread.dailyRows. */
function chartDaysSvg(rows) {
  const W = 720; const H = 300; const L = 62; const R = 16; const T = 14; const B = 108; const pw = W - L - R; const ph = H - T - B;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"`;
  const style = '<style>text{fill:#1f2328;font:11px Verdana,DejaVu Sans,sans-serif;font-variant-numeric:tabular-nums}.ax{stroke:#8c959f;stroke-width:1}.gr{stroke:#8c959f;stroke-opacity:.35;stroke-width:1}'
    + '.est{fill-opacity:.4;stroke:#8c959f;stroke-width:1;stroke-dasharray:3 2}.key{fill:#8c959f;fill-opacity:.4;stroke:#8c959f;stroke-dasharray:3 2}.keym{fill:#8c959f}'
    + '@media (prefers-color-scheme:dark){text{fill:#e6edf3}}' + seriesCss() + '</style>';
  if (!rows.length) {
    const t = `Daily build cost (${LABEL}): no days recorded yet`;
    return `${head} aria-label="${esc(t)}"><title>${esc(t)}</title>${style}<text x="${W / 2}" y="${H / 2}" text-anchor="middle">${esc(t)}</text></svg>\n`;
  }
  const names = [];
  const tot = (r, n) => (r.est[n] || 0) + (r.meas[n] || 0);
  for (const r of rows) for (const n of [...Object.keys(r.est), ...Object.keys(r.meas)]) if (!names.includes(n)) names.push(n);
  const sumOf = (n) => rows.reduce((a, r) => a + tot(r, n), 0);
  names.sort((a, b) => sumOf(b) - sumOf(a) || (a < b ? -1 : 1));
  for (let i = names.length - 1; i >= 0; i--) if (sumOf(names[i]) <= 0) names.splice(i, 1); // only models with an amount
  const cls = (n) => `s${Math.min(names.indexOf(n), SERIES_COLORS.length - 1)}`;
  const dayTotal = (r) => names.reduce((a, n) => a + tot(r, n), 0);
  const top = Math.max(...rows.map(dayTotal), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(top))); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= top);
  const ymax = step * Math.ceil(top / step);
  const y = (v) => T + ph - (v / ymax) * ph;
  const slot = pw / rows.length; const bw = Math.min(40, slot * 0.7);
  const estTotal = rows.reduce((a, r) => a + r.estCents, 0) / 100; const estDays = rows.filter((r) => r.estCents > 0).length;
  const estFrom = rows.find((r) => r.estCents > 0); const estTo = [...rows].reverse().find((r) => r.estCents > 0);
  const kind = (r) => (r.estCents > 0 && r.measCents === 0 ? ' estimated' : r.estCents > 0 ? ' part estimated' : ' measured');
  const desc = `Daily build cost, ${LABEL}: ${rows.map((r) => `${r.date} US$${group(dayTotal(r))}${kind(r)}`).join('; ')}`;
  const out = [`${head} aria-label="${esc(desc)}"><title>${esc('Daily build cost (' + LABEL + ')')}</title><desc>${esc(desc)}</desc>${style}`];
  for (let v = 0; v <= ymax + 1e-9; v += step) out.push(`<line class="gr" x1="${L}" y1="${f1(y(v))}" x2="${W - R}" y2="${f1(y(v))}"/><text x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end">US$${group(v)}</text>`);
  const every = Math.ceil(rows.length / Math.max(1, Math.floor(pw / 40)));
  rows.forEach((r, i) => {
    const cx = L + slot * (i + 0.5); let acc = 0;
    for (const part of ['meas', 'est']) for (const n of names) {
      const v = r[part][n] || 0; if (v <= 0) continue;
      out.push(`<rect x="${f1(cx - bw / 2)}" y="${f1(y(acc + v))}" width="${f1(bw)}" height="${f1(y(acc) - y(acc + v))}" class="${cls(n)}${part === 'est' ? ' est' : ''}"/>`);
      acc += v;
    }
    if (i % every === 0 || i === rows.length - 1) out.push(`<text x="${f1(cx)}" y="${T + ph + 14}" text-anchor="middle">${esc(r.date.slice(5))}</text>`);
  });
  out.push(`<line class="ax" x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}"/><line class="ax" x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}"/>`);
  out.push(`<text x="${L + pw / 2}" y="${T + ph + 30}" text-anchor="middle">day, UTC (US$ per day, ${esc(LABEL)})</text>`);
  let lx = L;
  for (const n of names.slice(0, SERIES_COLORS.length)) {
    const label = modelName(n);
    out.push(`<rect x="${lx}" y="${H - 54}" width="10" height="10" class="${cls(n)}"/><text x="${lx + 14}" y="${H - 45}">${esc(label)}</text>`);
    lx += 14 + Math.round(label.length * 6.6) + 14;
  }
  out.push(`<rect x="${lx}" y="${H - 54}" width="10" height="10" class="keym"/><text x="${lx + 14}" y="${H - 45}">solid = measured</text>`);
  out.push(`<rect x="${lx + 120}" y="${H - 54}" width="10" height="10" class="key"/><text x="${lx + 134}" y="${H - 45}">faded, dashed = estimated (spread)</text>`);
  if (estDays) {
    out.push(`<text x="${L}" y="${H - 28}">Estimate: US$${group(estTotal)} over ${estDays} days (${esc(estFrom.date)} to ${esc(estTo.date)}), weighted 50% by lines changed</text>`);
    out.push(`<text x="${L}" y="${H - 14}">and 50% by merged PRs per day (git history); model mix of the original lump. See docs/build-cost.md.</text>`);
  }
  out.push('</svg>\n');
  return out.join('');
}

module.exports = {
  DAY_SPREAD_LINE, chartDaysSvg, detailBlock, rewriteDetail, scopeClause, rewriteBadgeAlt, badgeAlt, DETAIL_BEGIN, DETAIL_END, TOKEN_METRIC, COST_METRIC, TYPES, SOURCES, MODEL_RE, MACHINE_RE, DATE_RE, MAX_FILE_BYTES, MAX_MODELS_PER_DAY, MAX_DAYS_PER_FILE, MAX_DAYS_PER_REQUEST, FILE_VERSION,
  SCOPE, DEFAULT_REPOS, REPO_ATTR, parseRepos, normalizeRepo, modelName, MODEL_NAMES, BEGIN, END, LABEL, validateHistory, upsertRow, badgeSvg, chartSvg, esc, validateBaseline, cumulative, readmeBlock, rewriteReadme, emptyState, checkMachine, dayOf, ingest, validateState, firstDay, report, group, usd,
};
