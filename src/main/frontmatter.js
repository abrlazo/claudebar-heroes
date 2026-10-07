// Reads the few frontmatter fields the app cares about from a markdown file
// (agents, skills and slash commands all use the same `---` header).

const fs = require('fs');

/** { name, description, argumentHint } from the file's YAML frontmatter (empty strings when absent), or null if unreadable. */
function readFrontmatter(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const lines = front ? front[1].split(/\r?\n/) : [];
  const field = (key) => {
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at === -1) return '';
    const value = lines[at].slice(key.length + 1).trim();
    const block = value.match(/^([>|])[+-]?$/);
    if (!block) return value.replace(/^["']|["']$/g, '');
    // YAML block scalar: the indented lines that follow (joined into one line).
    const body = [];
    for (let i = at + 1; i < lines.length && (/^\s/.test(lines[i]) || !lines[i].trim()); i++) body.push(lines[i].trim());
    // Descriptions show on one line in the popup, so a '|' text is joined with spaces too.
    return body.join(' ').replace(/\s+/g, ' ').trim();
  };
  return { name: field('name'), description: field('description'), argumentHint: field('argument-hint') };
}

module.exports = { readFrontmatter };
