// Finds the agent definitions a project can invoke with "/<name>".
//
// An agent is a markdown file under a `.claude/agents/` folder: the active
// project's own (<project>/.claude/agents) and the user's (~/.claude/agents).
// Skills, slash commands and built-in agents are NOT agents here. A project
// definition wins over a user one with the same name.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFrontmatter } = require('./frontmatter');

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function parseDefinition(file) {
  const front = readFrontmatter(file);
  if (!front) return null;
  const name = front.name || path.basename(file, '.md');
  if (!NAME_PATTERN.test(name)) return null;
  return { name, description: front.description };
}

function readFolder(dir, source) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files
    .map((f) => parseDefinition(path.join(dir, f)))
    .filter(Boolean)
    .map((def) => ({ ...def, source }));
}

/** Agents available in `projectPath`: [{ name, description, source: 'project' | 'user' }]. */
function listDefinitions(projectPath) {
  const byName = new Map();
  for (const def of readFolder(path.join(os.homedir(), '.claude', 'agents'), 'user')) {
    byName.set(def.name.toLowerCase(), def);
  }
  if (projectPath) {
    for (const def of readFolder(path.join(projectPath, '.claude', 'agents'), 'project')) {
      byName.set(def.name.toLowerCase(), def);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The definition called `name` (case-insensitive), or null. */
function findDefinition(projectPath, name) {
  if (typeof name !== 'string') return null;
  return listDefinitions(projectPath).find((d) => d.name.toLowerCase() === name.toLowerCase()) || null;
}

module.exports = { listDefinitions, findDefinition, readFolder, NAME_PATTERN };
