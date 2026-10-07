// Everything the user can invoke with "/" in the chat, for the suggestion popup.
//
// Claude itself is the source of truth for what runs: `claude.listCommands` returns the
// commands it recognises in headless mode (built-ins such as /context and /compact, skills,
// custom commands, plugin skills). They are labelled:
//   builtin - shipped with Claude Code (built-in commands and bundled skills)
//   skill   - a skill (on disk, or one Claude reports with a source such as "(user)")
//   command - a custom command from .claude/commands
// Agents are not in Claude's list; they come from .claude/agents on disk (they run through
// agents.js). If Claude's list is not available, skills and commands found on disk are used instead.
// Commands that only work in a terminal, and internal ones, are left out.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFrontmatter } = require('./frontmatter');
const { readFolder: readAgents } = require('./agent-definitions');

const NAME = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/;
const KIND_ORDER = { agent: 0, skill: 1, command: 2, builtin: 3 };
// Listed by Claude but terminal-only (Claude's init message calls them terminal_slash_commands)
// or internal, so they do nothing useful in the chat.
const NOT_FOR_CHAT = new Set(['doctor', 'color', 'focus', 'reload-plugins', 'workflow-launch-exec']);
const MAX_DESCRIPTION = 200;

function entry(name, kind, source, front) {
  if (!NAME.test(name)) return null;
  const description = (front?.description || '').slice(0, MAX_DESCRIPTION);
  return { name, kind, source, description, argumentHint: front?.argumentHint || '' };
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readSkills(claudeDir, source) {
  const dir = path.join(claudeDir, 'skills');
  const found = [];
  for (const item of listDir(dir)) {
    if (item.isDirectory()) {
      const file = path.join(dir, item.name, 'SKILL.md');
      const front = readFrontmatter(file);
      if (front) found.push(entry(front.name || item.name, 'skill', source, front));
    }
    // Flat files (skills/<name>.md) are not skills: Claude only loads skills/<name>/SKILL.md.
  }
  return found;
}

function readCommands(claudeDir, source) {
  const dir = path.join(claudeDir, 'commands');
  const found = [];
  for (const item of listDir(dir)) {
    if (item.isDirectory()) {
      // One level of folders becomes a namespace: commands/git/sync.md -> "git:sync".
      for (const inner of listDir(path.join(dir, item.name))) {
        if (!inner.isFile() || !inner.name.endsWith('.md')) continue;
        const front = readFrontmatter(path.join(dir, item.name, inner.name));
        if (front) found.push(entry(`${item.name}:${path.basename(inner.name, '.md')}`, 'command', source, front));
      }
    } else if (item.name.endsWith('.md')) {
      const front = readFrontmatter(path.join(dir, item.name));
      if (front) found.push(entry(path.basename(item.name, '.md'), 'command', source, front));
    }
  }
  return found;
}

// Claude marks skills from outside the project with a trailing source label, e.g. "Fix the thing (user)",
// "... (claude.ai sync)", "... (dynamic workflow)". Other trailing parentheses are just part of the text
// ("... (resumable with /resume)"), so only these labels count.
const SKILL_SOURCE_LABEL = /^(user|project|plugin[^()]*|claude\.ai sync|dynamic workflow)$/i;

// "Fix the thing (user)" -> { text: "Fix the thing", marker: "user" }
function splitMarker(description) {
  const m = description.match(/^([\s\S]*?)\s*\(([^()]+)\)\s*$/);
  return m && SKILL_SOURCE_LABEL.test(m[2]) ? { text: m[1], marker: m[2] } : { text: description, marker: '' };
}

function scanDisk(projectPath) {
  const roots = [{ dir: path.join(os.homedir(), '.claude'), source: 'user' }];
  if (projectPath) roots.push({ dir: path.join(projectPath, '.claude'), source: 'project' });
  const byKey = new Map(); // later roots (the project) replace earlier ones (the user)
  for (const { dir, source } of roots) {
    const agents = readAgents(path.join(dir, 'agents'), source).map((d) => entry(d.name, 'agent', source, d));
    for (const item of [...agents, ...readSkills(dir, source), ...readCommands(dir, source)]) {
      if (item) byKey.set(`${item.kind}:${item.name.toLowerCase()}`, item);
    }
  }
  return [...byKey.values()];
}

// The popup can reopen quickly, so a scan is reused for a few seconds.
const SCAN_TTL = 5000;
const scanCache = new Map(); // project path -> { at, entries }
function diskEntries(projectPath) {
  const hit = scanCache.get(projectPath);
  if (hit && Date.now() - hit.at < SCAN_TTL) return hit.entries;
  const entries = scanDisk(projectPath);
  scanCache.set(projectPath, { at: Date.now(), entries });
  return entries;
}

/**
 * [{ name, kind: 'agent' | 'skill' | 'command' | 'builtin', source, description, argumentHint }] for `projectPath`.
 * `claudeCommands` is Claude's own list (from claude.listCommands) or null when unavailable.
 */
function listCatalog(projectPath, claudeCommands = null) {
  const disk = diskEntries(projectPath);
  const agents = disk.filter((e) => e.kind === 'agent');
  if (!claudeCommands) {
    const names = new Set(agents.map((a) => a.name.toLowerCase()));
    return disk.filter((e) => e.kind === 'agent' || !names.has(e.name.toLowerCase())).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
  }

  const onDisk = new Map(disk.filter((e) => e.kind !== 'agent').map((e) => [e.name.toLowerCase(), e]));
  const fromClaude = [];
  // The agent wins a name clash (parseAgentInvocation picks it); Claude may also list a name twice.
  const taken = new Set(agents.map((a) => a.name.toLowerCase()));
  for (const c of claudeCommands) {
    if (!NAME.test(c.name) || NOT_FOR_CHAT.has(c.name) || c.name.startsWith('_')) continue;
    if (taken.has(c.name.toLowerCase())) continue;
    taken.add(c.name.toLowerCase());
    const local = onDisk.get(c.name.toLowerCase());
    const { text, marker } = splitMarker(c.description || '');
    const kind = local ? local.kind : marker ? 'skill' : 'builtin';
    fromClaude.push({
      name: c.name,
      kind,
      source: local ? local.source : marker || 'built in',
      description: (local?.description || text).slice(0, MAX_DESCRIPTION),
      argumentHint: c.argumentHint || local?.argumentHint || '',
    });
  }
  return [...agents, ...fromClaude].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

module.exports = { listCatalog };
