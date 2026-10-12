// Keeps the first `head` and the last `tail` characters of everything appended (pure). Used for a child's
// stderr: the start holds what Claude prints for a bad flag, the end holds the latest error.
function createCapped(head = 16384, tail = 49152) {
  let first = '';
  let last = '';
  let dropped = false;
  return {
    add(chunk) {
      if (first.length < head) {
        const room = head - first.length;
        first += chunk.slice(0, room);
        chunk = chunk.slice(room);
      }
      if (!chunk) return;
      last += chunk;
      if (last.length > tail) {
        last = last.slice(last.length - tail);
        dropped = true;
      }
    },
    text() {
      return dropped ? `${first}\n[... earlier output omitted ...]\n${last}` : first + last;
    },
  };
}

module.exports = { createCapped };
