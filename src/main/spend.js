// Lifetime spend per project (workspace.spend): runs, cost, Claude time, turns.
// Pure functions, no electron import, so tools/check-spend.mjs can require this file.
//
// Main builds the numbers from `result` events it sees itself; the renderer never sends any.
// Cost is kept as integer micro-dollars so sums stay exact.

const MAX_RESULT_USD = 1000;
const MAX_RESULT_MS = 24 * 60 * 60 * 1000;
const MAX_RESULT_TURNS = 100000;
const MAX_MICRO = 1e6 * 1e6; // $1,000,000
const MAX_RUNS = 1e9;
const MAX_MS = 1e12;
const MAX_TURNS = 1e12;

const emptySpend = () => ({ runs: 0, costMicro: 0, durationMs: 0, turns: 0 });

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clampInt = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0);

// Anything that is not a plain object of sane numbers becomes zero; a new object is always built.
function cleanSpend(raw) {
  if (!isPlain(raw)) return emptySpend();
  return {
    runs: clampInt(raw.runs, MAX_RUNS),
    costMicro: clampInt(raw.costMicro, MAX_MICRO),
    durationMs: clampInt(raw.durationMs, MAX_MS),
    turns: clampInt(raw.turns, MAX_TURNS),
  };
}

// Adds one `result` event. A bad value counts as 0; a failed run still adds its cost but is not a successful run.
function addResult(spend, ev) {
  const old = cleanSpend(spend);
  if (!isPlain(ev)) return old;
  const usd = Number.isFinite(ev.costUsd) && ev.costUsd >= 0 && ev.costUsd <= MAX_RESULT_USD ? ev.costUsd : 0;
  const ms = Number.isFinite(ev.durationMs) && ev.durationMs >= 0 && ev.durationMs <= MAX_RESULT_MS ? ev.durationMs : 0;
  const turns = Number.isFinite(ev.turns) && ev.turns >= 0 && ev.turns <= MAX_RESULT_TURNS ? Math.floor(ev.turns) : 0;
  return cleanSpend({
    runs: old.runs + (ev.isError ? 0 : 1),
    costMicro: old.costMicro + Math.round(usd * 1e6),
    durationMs: old.durationMs + Math.round(ms),
    turns: old.turns + turns,
  });
}

const usd = (spend) => cleanSpend(spend).costMicro / 1e6;

module.exports = { emptySpend, cleanSpend, addResult, usd, MAX_RESULT_USD, MAX_RESULT_MS };
