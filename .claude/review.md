# feature-reviewer findings: "/" popup, command catalog, /plan (most severe first)

1. **IPC safety, `src/main/main.js` ~358 and ~383.** `agents:run` / `agents:message` pass the renderer's `permissionMode` straight into `claude.run` (`--permission-mode <value>`, and `claude.js` uses `shell: isWin`), so on Windows this is argument injection and elsewhere it allows arbitrary flag values. `agents:message` also trusts a renderer-supplied `cwd` and `sessionId`. `displayName` is stored unchecked.
   Fix: one shared `PERMISSION_MODES` allowlist (also used by `settings:update`), fall back to `settings.get().permissionMode` when not in it. In `agents:message` take `cwd` from `ws.path` (return if the workspace is missing) and require `typeof sessionId === 'string'`. Require `typeof displayName === 'string'`, trim, cap at about 40 characters.

2. **Error handling, `src/renderer/App.tsx` ~150.** `await bar.agentDefinitions(ws.id)` has no try/catch; if it rejects, the Composer has already cleared the text and the message is lost. State read after the await (`agents.selectedId`, `projectBusy`) can be stale.
   Fix: `try { ... } catch { definitions = [] }` so it falls through as an ordinary message; read tab/busy state from refs after the await.

3. **`/plan`, `src/renderer/App.tsx` ~159-173.**
   - `/plan <task>` sets and persists plan mode and posts the meta message before `if (projectBusy) return`; with a run active the task is silently dropped. Do the busy check first (or save the user message and a "busy, not sent" meta message).
   - Plan mode persists in `settings.json`, so a one-off `/plan` makes the next session read-only. Either apply it only to this send, or keep it persistent and say so in the meta message.
   - Skip the "Plan mode is on" message when `settings.permissionMode` is already `'plan'`.

4. **Settings allowlist, `src/main/main.js` ~325-330.** `panelHeight` returns early, so a patch that also has `theme` or `permissionMode` loses the second field; `panelHeight` is not checked as a number (a string gives `NaN`) and `applyBounds` runs first.
   Fix: validate `Number.isFinite(patch.panelHeight)`, build one `allowed` object (`panelHeight`, `theme`, `permissionMode`) and make a single `settings.set(allowed)` at the end.

5. **Light theme, `src/renderer/styles/styles.css` ~603-610.** Kind badge colours are fixed (`#fbbf24`, `#34d399`, `#60a5fa`, `#f472b6`) and low-contrast on the light popup; `.command-desc` uses a muted colour with about 2.7:1 contrast.
   Fix: add light-theme overrides for `.command-kind.kind-*` with darker shades (e.g. `#b45309`, `#047857`, `#1d4ed8`, `#be185d`, `#6d28d9`) and a darker description colour.

6. **Frontmatter, `src/main/frontmatter.js` ~16-17.** The one-line regex returns `>` or `|` for YAML block scalars (`description: >` then indented lines), so the popup shows a description of just `>`.
   Fix: for `[>|][+-]?` join the following indented lines (fold for `>`, keep newlines for `|`).

7. **Duplicates, `src/main/command-catalog.js` ~108-123 and `src/renderer/lib/commands.ts` ~42.** Claude's list can contain the same name twice (user skill and plugin skill), giving duplicate React keys (`${kind}:${name}`) and duplicate rows. An agent and a skill with the same name both show, but `parseAgentInvocation` picks the agent.
   Fix: dedupe `fromClaude` by lowercased name; drop a skill/command entry whose name matches an agent.

8. **Performance, `src/main/main.js` ~335-349 and `src/renderer/hooks/useCommandCatalog.ts` ~27.** The hook refreshes on mount and every workspace change, spawning `claude` even if the user never types "/". `diskEntries` does synchronous `readdirSync`/`readFileSync` on the main thread. `claudeCommandCache` never evicts. `listCommands` never reads the child's stderr.
   Fix: remove the eager `useEffect(() => refresh())` and load on the first popup open only; cache the disk scan for a few seconds or use `fs.promises`; delete the cache entry when a workspace is removed; add `child.stderr.resume()`.

9. **Keyboard, `src/renderer/components/common/Composer.tsx` ~71-90.** The popup's Enter/Tab branch lacks `!e.nativeEvent.isComposing` (the send path has it), so confirming an IME composition can pick a suggestion. Typing a path like `/tmp/x` also hits the popup when a name contains the text, and Enter replaces the user's text.
   Fix: add the `isComposing` check; let Enter send (not pick) when the text exactly equals a listed `/name` with no space.

10. **Agents, `src/main/main.js` ~383-388.** If the agent definition file was deleted or renamed, `agents:message` resumes the session as a plain run with no `--agent`, while the tab still shows the agent's name.
    Fix: when `definitionName` was given but not found, emit an error/meta message, or reuse the stored definition name without the on-disk lookup.
