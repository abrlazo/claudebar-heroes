// Pure check for the workflow pipeline model (lib/pipeline.ts): states, order, caps, clipping, permissions,
// other projects, chains, queue, sameModel, the linger rule, headline wording, no mutation.
// The types are stripped with node:module (Node 22.13+), so the .ts file is tested as it is. Usage: npm run check

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-pipeline-'));
fs.writeFileSync(path.join(tmp, 'pipeline.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/pipeline.ts'), 'utf8')));
const P = await import(pathToFileURL(path.join(tmp, 'pipeline.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });
const { buildPipeline, sameModel, shouldShow, isActive, cleanText, elapsedLabel, MAX_NODES, DETAIL_MAX, QUEUED_MAX, LINGER_MS } = P;

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  pipeline: ${name}${detail ? `  (${detail})` : ''}`); };

const quiet = { wsId: null, running: false, starting: false, startedAt: null };
const input = (over = {}) => ({ wsId: 'w1', quest: { ...quiet, wsId: 'w1' }, agents: [], chainSteps: {}, permissions: [], queued: [], since: 0, ...over });
const agent = (id, over = {}) => ({ id, name: id, wsId: 'w1', status: 'running', startedAt: 100, ...over });
const states = (m) => m.nodes.map((n) => `${n.id}=${n.state}`).join(',');

const empty = buildPipeline(input());
check('empty input is inactive with no nodes', !empty.active && empty.nodes.length === 0 && empty.headline === '' && !isActive(empty));

const q = buildPipeline(input({ quest: { ...quiet, wsId: 'w1', running: true, startedAt: 5, lastTool: { name: 'Bash', summary: 'ls' }, toolCount: 2 } }));
check('Quest running with its tool', q.active && q.nodes[0].kind === 'quest' && q.nodes[0].state === 'running' && q.nodes[0].detail === 'Bash: ls' && q.nodes[0].tools === 2, states(q));
const qs = buildPipeline(input({ quest: { ...quiet, wsId: 'w1', starting: true } }));
check('Quest starting counts as running, detail "starting"', qs.nodes[0].state === 'running' && qs.nodes[0].detail === 'starting');
for (const [outcome, state] of [['done', 'done'], ['failed', 'failed'], ['cancelled', 'cancelled']]) {
  const m = buildPipeline(input({ quest: { ...quiet, wsId: 'w1', startedAt: 5, endedAt: 50, outcome } }));
  check(`Quest ended ${outcome}`, m.nodes[0].state === state && !m.active && m.nodes[0].endedAt === 50);
}
check('an old finished Quest (before the burst) is not shown', buildPipeline(input({ since: 100, quest: { ...quiet, wsId: 'w1', startedAt: 5, endedAt: 50, outcome: 'done' } })).nodes.length === 0);

const a = buildPipeline(input({ agents: [agent('a'), agent('b', { status: 'done', outcome: 'done', endedAt: 200 }), agent('c', { status: 'done', outcome: 'error', endedAt: 200 }), agent('d', { status: 'done', outcome: 'cancelled', endedAt: 200 })] }));
check('agent running / done / failed / cancelled', states(a) === 'agent:a=running,agent:b=done,agent:c=failed,agent:d=cancelled', states(a));
check('an old finished agent is not shown', buildPipeline(input({ since: 500, agents: [agent('x', { status: 'done', outcome: 'done', startedAt: 100, endedAt: 200 })] })).nodes.length === 0);
const obs = buildPipeline(input({ agents: [agent('o', { observed: true })] }));
check('observed agent shows as delegated', obs.nodes[0].detail === 'delegated by Claude');
check('agents are ordered by start time, after the Quest', states(buildPipeline(input({
  quest: { ...quiet, wsId: 'w1', running: true },
  agents: [agent('late', { startedAt: 300 }), agent('early', { startedAt: 200 })],
}))) === 'quest=running,agent:early=running,agent:late=running');

const chain = buildPipeline(input({ agents: [agent('a')], chainSteps: { a: { wsId: 'w1', names: ['b', 'c'] } } }));
check('chain: a running node plus two waiting steps', states(chain) === 'agent:a=running,chain:a:0=waiting,chain:a:1=waiting' && chain.nodes[1].label === '/b' && chain.nodes[2].detail === 'after b' && chain.nodes[1].detail === 'after a', states(chain));
check('chain steps turn into nodes as agents start', states(buildPipeline(input({ agents: [agent('a', { status: 'done', outcome: 'done', endedAt: 150 }), agent('b2', { startedAt: 160 })], chainSteps: { b2: { wsId: 'w1', names: ['c'] } } }))) === 'agent:a=done,agent:b2=running,chain:b2:0=waiting');
check('chain steps of another project are not shown', buildPipeline(input({ agents: [agent('a')], chainSteps: { a: { wsId: 'w2', names: ['b'] } } })).nodes.length === 1);

const askQ = buildPipeline(input({ quest: { ...quiet, wsId: 'w1', running: true }, permissions: [{ owner: { kind: 'quest', wsId: 'w1' } }] }));
check('a Quest permission makes the Quest node asking (also for a delegated agent: it is a Quest request)', askQ.nodes[0].state === 'asking' && askQ.headline === '1 waiting for OK', askQ.headline);
const askA = buildPipeline(input({ agents: [agent('a'), agent('b')], permissions: [{ owner: { kind: 'agent', agentId: 'b' } }] }));
check('an agent permission makes that agent asking', states(askA) === 'agent:a=running,agent:b=asking' && askA.headline === '1 running · 1 waiting for OK', askA.headline);
check('a request of another project does not touch this one', buildPipeline(input({ quest: { ...quiet, wsId: 'w1', running: true }, permissions: [{ owner: { kind: 'quest', wsId: 'w2' } }] })).nodes[0].state === 'running');

const other = buildPipeline(input({ agents: [agent('mine'), agent('x1', { wsId: 'w2' }), agent('x2', { wsId: 'w2' }), agent('x3', { wsId: 'w2', status: 'done', outcome: 'done', endedAt: 120 })] }));
check('other-project agents are a line, never nodes', other.nodes.length === 1 && other.notes.join('|') === '+2 in other projects', other.notes.join('|'));
check('a Quest run of another project is a line too', buildPipeline(input({ quest: { ...quiet, wsId: 'w2', running: true } })).notes[0] === '+1 in other projects');

const qd = buildPipeline(input({ quest: { ...quiet, wsId: 'w1', running: true }, queued: ['x'.repeat(100), 'second'] }));
check('queued messages: one node each, clipped, last in order', qd.nodes.length === 3 && qd.nodes[1].kind === 'queued' && qd.nodes[1].detail.length === QUEUED_MAX && qd.nodes[1].detail.endsWith('…') && qd.nodes[2].detail === 'second' && qd.headline === '1 running · 2 queued', qd.headline);
check('queued messages alone are not active work', !buildPipeline(input({ queued: ['x'] })).active);

const many = buildPipeline(input({ agents: Array.from({ length: 15 }, (_, i) => agent(`a${i}`, { startedAt: i })) }));
check('12-node cap with "+N more"', MAX_NODES === 12 && many.nodes.length === 12 && many.notes[0] === '+3 more', many.notes.join('|'));

const long = buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Bash', summary: `echo ‮\u0007${'y'.repeat(200)}\nsecond line` } })] }));
check('detail is clipped to 80, one line, control/bidi stripped', long.nodes[0].detail.length === DETAIL_MAX && !/[\u0000-\u001f‮]/.test(long.nodes[0].detail) && long.nodes[0].detail.endsWith('…'));
check('cleanText strips zero-width and collapses spaces', cleanText('a​  b\tc', 80) === 'a b c');
check('agent names are cleaned', buildPipeline(input({ agents: [agent('a', { name: 'ev‮il\u0001' })] })).nodes[0].label === 'ev il');

check('headline after the work: done, failed, stopped', buildPipeline(input({ agents: [agent('a', { status: 'done', outcome: 'done', endedAt: 1 }), agent('b', { status: 'done', outcome: 'error', endedAt: 1 }), agent('c', { status: 'done', outcome: 'cancelled', endedAt: 1 })] })).headline === '1 done · 1 failed · 1 stopped');

// sameModel
const m1 = buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Read', summary: 'x' } })] }));
const m2 = buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Read', summary: 'x' }, lastActivityAt: 9 })] }));
const m3 = buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Read', summary: 'y' } })] }));
const m4 = buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Read', summary: 'x' }, status: 'done', outcome: 'done', endedAt: 5 })] }));
check('sameModel: a re-built identical model', sameModel(m1, m2) && sameModel(m1, m1));
check('sameModel: false when detail or state changes', !sameModel(m1, m3) && !sameModel(m1, m4));
check('sameModel: false when a note or the node count changes', !sameModel(m1, buildPipeline(input({ agents: [agent('a'), agent('b')] }))) && !sameModel(m1, buildPipeline(input({ agents: [agent('a', { lastTool: { name: 'Read', summary: 'x' } }), agent('z', { wsId: 'w2' })] }))));

// linger
check('linger: shown while working', shouldShow({ working: true, lastWorkAt: null, now: 0, hasNodes: true }));
check('linger: shown for 4 s after the work', LINGER_MS === 4000 && shouldShow({ working: false, lastWorkAt: 1000, now: 4999, hasNodes: true }) && !shouldShow({ working: false, lastWorkAt: 1000, now: 5000, hasNodes: true }));
check('linger: never shown without nodes or without any work', !shouldShow({ working: true, lastWorkAt: 1, now: 1, hasNodes: false }) && !shouldShow({ working: false, lastWorkAt: null, now: 1, hasNodes: true }));
check('elapsedLabel', elapsedLabel(12999) === '12s' && elapsedLabel(65000) === '1m 05s' && elapsedLabel(-5) === '0s');

// no mutation
const frozen = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') frozen(v); }); return Object.freeze(o); };
let threw = false;
try {
  buildPipeline(frozen(input({
    quest: { ...quiet, wsId: 'w1', running: true, lastTool: { name: 'a', summary: 'b' } },
    agents: [agent('b', { startedAt: 2 }), agent('a', { startedAt: 1 })], chainSteps: { a: { wsId: 'w1', names: ['c'] } },
    permissions: [{ owner: { kind: 'agent', agentId: 'a' } }], queued: ['q'],
  })));
} catch { threw = true; }
check('input is never mutated (frozen input, unsorted agents)', !threw);

if (failed) { console.log(`${failed} pipeline check(s) failed`); process.exit(1); }
