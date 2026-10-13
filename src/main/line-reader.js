// Splits a text stream into lines (pure, no electron import; tools/check-line-reader.mjs tests it).
// Each chunk is scanned once: a very long line (a big tool result) arriving in many chunks is not
// rescanned from its start on every chunk, and complete lines are cut out without re-slicing the rest each time.
// Feed it decoded text (`stream.setEncoding('utf8')`), so a character split across two chunks stays whole.

/** @param {(line: string) => void} onLine  called with each complete line, trimmed, never empty */
function createLineReader(onLine) {
  let buffer = '';
  let scanned = 0; // buffer[0, scanned) holds no '\n'
  return {
    push(chunk) {
      buffer += chunk;
      let start = 0;
      let nl;
      while ((nl = buffer.indexOf('\n', scanned)) !== -1) {
        const line = buffer.slice(start, nl).trim();
        start = nl + 1;
        scanned = start;
        if (line) onLine(line);
      }
      if (start) buffer = buffer.slice(start);
      scanned = buffer.length;
    },
  };
}

module.exports = { createLineReader };
