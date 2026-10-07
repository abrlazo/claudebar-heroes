# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Claudebar Heroes** is an Electron-based taskbar companion for Claude Code that visualizes Claude's work as a pixel-art RPG. The user's projects are "workspaces," each with a randomly-generated hero that levels up as Claude uses context tokens. When Claude works, monsters appear (one per tool call): goblins, skeletons, orcs and imps. They walk up, fight the hero, and get fought back. Every 8 kills triggers a stage clear and map progression.

Key recent features:
- **Themes**: Dark/Light mode toggle
- **Resizable panels**: Drag bottom edge to resize chat (300-1000px)
- **Agents**: type `/<agent-name> <task>` (the name must be a file under `.claude/agents/`) and that agent runs in its own Claude process, with its own chat tab and spirit orb. Skills, other slash commands and built-in agents are not agents

## Running the App

```bash
npm start        # vite build, then launch Electron
npm run dev      # same as start, but opens DevTools
npm run watch    # rebuild the React UI on save (then Status -> Restart App)
npm run typecheck # tsc --noEmit over src/renderer
npm run check     # roster, hero-design validator and aura-width checks (tools/check-roster.mjs, tools/check-aura.mjs)
npm run simulate  # build, then run simulated /<agent> invocations, delegation, a boss fight (fake claude `LONGRUN` prompt) and check the UI (tools/simulate-agents.mjs)
```

The renderer is a React app bundled by Vite into `dist/renderer` (git-ignored); `main.js` loads that folder. Edit `src/renderer`, never `dist`.

DevTools open on launch only with `npm run dev`; otherwise use the tray menu -> Open DevTools.

Set `CLAUDE_BIN=/path/to/claude` if the `claude` binary isn't in PATH.

The app spawns Claude Code headlessly (`claude -p --output-format stream-json`) and parses its event stream.

## Architecture

### Main Process (`src/main/`)

**main.js** - Window lifecycle, IPC routing, panel positioning
- Manages frameless, transparent, always-on-top window
- Handles dragging, panel open/close, position persistence
- Routes IPC calls between renderer and backend services

**claude.js** - Claude Code subprocess management
- Spawns single Claude process with streaming JSON output
- Parses events (text and thinking deltas, tool calls, `turn` = input tokens at the start of a model call, `usage` = final tokens of a call, session info)
- Converts Claude's event stream into UI-friendly event objects
- Spots Claude's own delegations: an assistant `tool_use` named `Agent` (older: `Task`) with `input.subagent_type` also emits `{type:'subagent', phase:'start', toolUseId, agentType, description, prompt}`. Messages with `parent_tool_use_id` are work inside that subagent and become `phase:'event'` (`inner:'tool'|'text'`) instead of the chat's own tool lines/text (their stream events are skipped, so they don't touch the token gauge). `phase:'end'` comes from the matching `tool_result` (the "[Subagent hand-back]" frame is stripped), or, for a background agent whose tool_result is only a launch notice (`tool_use_result.isAsync`), from the `task_notification` system event

**agents.js** - Agent processes
- Manages concurrent Claude processes, one per invoked agent (`claude --agent <name>`)
- At most 4 agents work at once (`MAX_AGENTS` in `lib/agents.ts`)
- Each agent tracks status, usage, session independently
- Agent tool calls also send named monsters at the hero; the HUD shows "N agents working…"

**agent-definitions.js** - Which agents exist
- Lists the markdown files in `<project>/.claude/agents/` and `~/.claude/agents/` (project wins on a name clash); `findDefinition` is the only gate that lets a name become an agent

**command-catalog.js** / **frontmatter.js** - What the "/" popup offers
- `listCatalog(projectPath, claudeCommands)` lists agents from `.claude/agents/<n>.md` (project and `~/.claude`, project wins), then merges Claude's own command list: `claude.listCommands(cwd)` (`claude.js`) sends an `initialize` control request over `--input-format stream-json` (no model call) and gets every runnable command (built-ins like `/compact` and `/context`, skills incl. plugin ones, custom commands). `main.js` caches it per project for 60 s (`claudeCommandsFor`). Entries get kind `agent | skill | command | builtin`; `NOT_FOR_CHAT` and `__internal` names are dropped. If Claude can't be asked, it falls back to scanning disk (skills only as `.claude/skills/<n>/SKILL.md`: flat `skills/<n>.md` do not run; commands `.claude/commands/<n>.md`, `<folder>/<n>.md` as `folder:n`)
- Built-ins answer with one complete `assistant` message and no streamed deltas; `handleMessage` in `claude.js` emits that text when nothing was streamed (`state.streamedText`)

**settings.js** - Persistent state
- Workspaces (projects with hero seed, progress, Claude session)
- Agents per workspace (name, status, usage, session)
- User preferences (theme, panelHeight)
- Each workspace keeps separate chat log and hero state

**preload.js** - IPC bridge
- Exposes safe methods to renderer (no direct Node access)
- Methods: list agent definitions, run/message/cancel agents, update settings, import/select workspaces, send prompts

### Renderer (`src/renderer/`)

React 19 + TypeScript + Vite (`strict`; run `npm run typecheck`). `engine/` stays plain JS (`allowJs`); `main/` is plain CommonJS JS. Shared types live in `types.ts` (settings, messages, events, the `window.bar` bridge). Import TS modules without extensions; engine imports keep `.js`. Layers, top to bottom (a layer only imports from layers below it):

- **`App.tsx`** - composition root: calls the hooks, passes props down. No UI of its own.
- **`components/`** - presentational React components (`strip/`, `panel/`, `panel/inventory/`, `common/`). Element ids/classes are kept stable because `styles/styles.css` targets them.
- **`hooks/`** - behaviour and IPC:
  - `useClaudeRun` - project chat run: Claude events -> saved messages (incl. thinking), live token usage, XP, hero reactions
  - `useAgents` - agents: start (`/<agent> <task>`), per-agent logs, orbs, follow-up messages
  - `useCommandCatalog` - the commands the "/" popup offers (reloaded each time the popup opens)
  - `useGeneralChat` - the Ask chat (in-memory, project-less)
  - `useGameEngine` - creates/destroys the canvas engine, returns a safe `game` facade
  - `usePanel`, `usePanelResize`, `useWindowDrag`, `useClickThrough`, `useStageStatus`, `useWorkspaceActions`, `useBridgeEvent`
- **`context/SettingsContext.tsx`** - renderer copy of settings.json; updates apply locally first, then persist via IPC
- **`engine/`** - framework-free game: `game.js` (state machine/loop), `scene.js`, `sprite.js`, `aura.js`, `prestige.js`, `heroes.js`, `enemies.js`, `minionSprite.js`. No React or IPC imports.
- **`lib/`** - pure helpers: `leveling`, `format`, `agents` (`/<agent>` parsing, limits, tab names), `commands` (popup entries, filtering), `models`, `heroCache`, `effects`, `bridge` (`window.bar`)

## Key Concepts

### Orchestrator & Workspaces

The **selected workspace** (`settings.activeId`) is the orchestrator. It determines:
- Which project folder Claude operates in
- Which Claude session (persists conversation per project)
- Which hero is displayed and its progress
- The chat log shown to the user

**Switching workspaces**:
1. `switchTo(nextSettings)` swaps the active workspace
2. Saves previous workspace's chat log to `logs` Map
3. Loads next workspace's chat log
4. Updates hero, progress, and game state
5. All subsequent Claude calls use new workspace's path/session

### Agent Spawning

The only way for the user to start an agent is `/<agent-name> <task>` at the start of a message in the Expedition chat. (When Claude itself delegates to a known agent, it is shown as an observed agent, see *Delegated agents* below.)

1. `App.tsx` sees a message starting with `/` and asks the main process for the agents the project has (`bar.agentDefinitions` -> `agent-definitions.js`: markdown files under `.claude/agents/`, the project's and the user's).
2. `parseAgentInvocation` (`lib/agents.ts`) accepts it only if the name matches one of those files (case-insensitive). **Anything else is not an agent**: skills (`/run`), other slash commands, built-in agents (`/Explore`), file paths (`/Users/...`) and text that merely contains an agent name all go to Claude as ordinary messages. There are no keyword triggers.
3. `/<agent>` with no task asks for one and starts nothing. At most 4 agents work at the same time.

**Chains**: `/a <task> && /b [task] [&& /c]` (`parseAgentChain` in `lib/agents.ts`, max `MAX_CHAIN_STEPS` = 3). Every step must be a known agent, otherwise it is not a chain and the text is handled as a single message. The first step starts as above; the rest are queued in `useAgents` (`chains`, keyed by the running agent, with the workspace it started in; not persisted, no tab or orb until they start). When an agent ends cleanly the next step starts in that workspace; its task is the step's own text, else (`handoffTask`) the previous agent's final message, or "Implement the findings in .claude/review.md" after `feature-planner` when the file exists (`bar.projectHasReview`, path taken from the workspace in main), else the chain stops with "no findings to implement". An error, non-zero exit, Stop, or closing the tab drops the rest with a meta message in the Expedition chat. If `MAX_AGENTS` are already running at hand-off, the chain stops with a message (it does not wait).
4. `bar.runAgent` -> `agents:run` starts ONE Claude process: `claude -p ... --agent <name>`, in the project folder, with the permission mode chosen in the footer (headless runs cannot ask, so tools like Bash need *Accept edits* or *Bypass perms*).
5. The agent gets a tab named after it (`gitama`, then `gitama 2` for a second run), its own log and a spirit orb. The user's `/<agent> <task>` line stays in the Expedition chat, the task is the first message in the agent's tab.

**The "/" suggestion popup** (Expedition composer only): typing `/` at the start of the text opens a list above the box (`components/common/CommandPopup.tsx`, driven by `Composer`). It lists agents, Claude's own commands (built-ins, skills, custom commands; `main/command-catalog.js`) plus the app's own `summon` and `/plan`. `/plan` is not a headless Claude command: `App.tsx` (`PLAN_COMMAND`) turns it into the *Plan only* permission mode and sends the rest as the task. `/help` and similar terminal-only commands do not run headless and are not listed. Typing narrows it (names that start with the text first, then ones that contain it); Up/Down moves, Enter or Tab picks (inserts `/name ` and does not send), Esc closes only the popup. Picking a skill or custom command just fills the box: sent as an ordinary message, Claude runs it. Picking an agent and adding a task starts it (see above). Add new kinds of command in `command-catalog.js` and `lib/commands.ts`.

**Delegated agents** (observed): when Claude itself calls its Agent tool for a type that matches a definition in `.claude/agents/` (project or `~/.claude`, same gate as `/<agent>`, case-insensitive; `bar.agentDefinitions`), `useClaudeRun` hands the `subagent` events to `useAgents.observe`, which creates an *observed* agent (`observed: true`) in the workspace that started the run: tab, orb, first message = the delegated prompt, inner tool calls in its log and as monsters, the result when it ends, and a meta line in the Expedition chat. Built-in types (`Explore`, `Plan`, `general-purpose`...) and unknown names are not agents: their inner calls come back to the run as ordinary tool lines (`onUnclaimed` -> `useClaudeRun.replay`). Observed agents have no process: the composer is disabled in their tab, Stop ends the whole Expedition run (they finish as cancelled), they do not use `MAX_AGENTS` start slots, and they count for the HUD and the hero's wake/sleep. They are kept in memory only (not saved, gone after a restart).

**Agent lifecycle**:
- Status: idle → running → done
- Minions animate in on spawn, animate out (death animation) on completion
- Finished agents stay (tab + orb) until closed with their ✕; you can keep messaging them
- All events from agents stream to their respective tabs
- With an agent tab open, the composer messages that agent (`useAgents.message` -> `agents:message` IPC resumes its Claude session); the view stays on the agent's tab and the main chat is untouched

### Settings & Persistence

**settings.json** (in Electron userData folder):
```json
{
  "theme": "dark" | "light",
  "panelHeight": 300-1000,
  "permissionMode": "default" | "acceptEdits" | "plan" | "bypassPermissions",
  "windowPos": { x, y },
  "summonDesigns": { "<lower-case name>": { /* same shape as heroDesign */ } },
  "activeId": "workspace-id",
  "migrations": { "trophyResetV1": true },
  "workspaces": [
    {
      "id": "uuid",
      "path": "/path/to/project",
      "name": "project-name",
      "heroSeed": "uuid",
      "kills": 0,
      "map": "forest" | "desert" | "snowy" | "lava" | "night",
      "sessionId": "claude-session-id",
      "usage": { input, output, cacheRead, cacheCreate },
      "contextWindow": 200000,
      "trophies": { "boss:forest": { "count": 1, "firstAt": timestamp } },
      "heroDesign": null | { cls, weapon, body, gear, hair, shield, cape, stache, glasses, colors: {...}, stats: {...}, at },
      "agents": [
        {
          "id": "uuid",
          "name": "Agent 1",
          "status": "running" | "done",
          "sessionId": "claude-session-id",
          "usage": { input, output, cacheRead, cacheCreate },
          "startTime": timestamp,
          "endTime": timestamp,
          "messages": []
        }
      ]
    }
  ]
}
```

## Performance Notes & Constraints

- IPC listeners: `preload.js` `on*` functions return an unsubscribe; always subscribe through `useBridgeEvent` so effects clean up.
- The engine's `ResizeObserver`, animation frame and timers are released by `game.destroy()` (called from `useGameEngine`).
- Pending hot spots: the game loop sorts/filters enemies each frame; `sprite.js` uses `getImageData`/`putImageData` per sprite frame (GPU pixel read, expensive).
- Chat history is capped by the main process; `MessageLog` renders every saved message, so avoid per-message heavy components.
- Engine appends enemy/damage nodes to `#stage` itself. React must not reorder or re-key children of the stage in a way that removes those nodes.

## Common Tasks

**Add a monster**:
- Add an entry (`kind`, `name`, `skin`, `cloth`, `weapon`, `hp`) to a map in `ENEMY_TYPES` (`engine/enemies.js`)
- A new `kind` needs a body function in `BODIES` that draws legs, free arm, torso and head and returns the weapon-arm shoulder; the rig handles walk / fight / idle animation
- Pick colours that contrast with the map background

**Add a feature** (when working with Claude Code on this repo, a new feature request is always orchestrated: `feature-planner` writes the plan to `.claude/review.md`, then `feature-implementer` builds it, runs the checks and deletes the file; in the app: `/feature-planner <idea> && /feature-implementer`):
1. Identify which workspace/setting it affects (`main/settings.js`; renderer mirror in `context/SettingsContext.tsx`)
2. Put behaviour in a hook (`hooks/`), pure logic in `lib/`, and UI in a component (`components/`)
3. Style in `styles/styles.css`
4. Add an IPC handler in `main/main.js` if it needs the backend, and expose it in `main/preload.js`
5. Wire the hook into `App.tsx` and pass props down

**Modify hero behavior**:
- Hero visuals: `engine/sprite.js` (draw) + `engine/heroes.js` (generate from seed)
- Hero animation: `engine/game.js` (state machine) + `engine/sprite.js` (rendering)
- Sleep/wake: the hero is awake exactly while Claude or an agent is working. `App.tsx` drives it with one effect on `busy` (`game.wake()` / `game.sleep()`); don't guard `game.sleep()` with a ref in event handlers, the ref is stale until the next render and the hero never falls asleep
- Summoned characters (`findSummon`, `CHARACTERS` in `engine/heroes.js`): typing "summon <name>" in the project chat swaps the active project's hero (`useWorkspaceActions.summonHero`, `bar.rerollHero(id, seed)`) and is not sent to Claude. Famous characters (Darth Vader, Yoda, Gandalf, Goku, Batman, Link, Naruto, Luffy, Zoro, Mario, Sonic, Spider-Man, Superman, Iron Man, Pikachu, Mega Man, Samus, Harry Potter, Kratos, Cloud Strife) have hand-built looks and stats and match anywhere in a message (longest alias first, aliases are regex-escaped); `findSummon` returns `famous`. Any other name needs a short message starting with "summon" (max 4 words): it first becomes a hero generated from `summon:<name>` wearing that name, and `summonHero` then calls `bar.designSummon(wsId, name)` -> `summon:design` (main.js): `claude.ask` (`claude.js`: one-shot `--output-format json`, `--tools ""`, no session, haiku, 25 s timeout or `HERO_DESIGN_TIMEOUT_MS`, cwd `<userData>/summon-cwd`, never the project) asks for a JSON look, `hero-design.js` (`validateDesign`) keeps only allowlisted parts, `#rrggbb` colours and clamped stats, and `settings.applyDesign` saves it as `workspace.heroDesign` and in `summonDesigns[name]` (max 50), so the same name is never asked twice. Any failure (timeout, no JSON, Claude missing) keeps the seed-generated hero and adds a meta message. The renderer never supplies a design: `workspace:reroll` takes only a seed and main attaches the saved design by name; `settings:set` drops `workspaces`/`summonDesigns`. `heroCache` keys on seed + design `at`. The allowlists in `hero-design.js` mirror `RIG` in `engine/heroes.js` (`npm run check` compares them and checks the roster). New gear for designs/characters: `strawhat cap fullmask ears` (plus hero flags `stache`, `glasses`) in `sprite.js`. Seeds come from `findSummon` only; the main process accepts just `secret:darth-vader` or `summon:<short plain name>` (`isSummonSeed` in `main/main.js`, keep in sync). To add a character, add an entry to `CHARACTERS` (names, quote, hero parts + colours + stats). Darth Vader also has a black helmet (`gear: 'vader'` in `sprite.js`) and a lightsaber whose red glow (`signatureGlow`) stays at every level
- XP thresholds: `levelFor`, `xpForLevel` in `lib/leveling.ts`
- Level prestige (`engine/prestige.js`): weapon glow from level 10, colour changes every 5 levels (10, 15, 20, ...); Super Saiyan-style aura from level 15 (lightning added from level 25), colour changes every 15 levels (15, 30, 45, ...; gold, blue, rose, purple, green, white). Palettes repeat. `App.tsx` passes the level to `game.configure({ level })`; the glow is drawn from the weapon's own pixels in `engine/sprite.js`; the aura (`engine/aura.js`: flame spikes, sparks, lightning, power-up burst) is drawn on `#aura-canvas` behind the hero and flares up while Claude works. Lightning only crackles from level 25 (`LIGHTNING_START` in `prestige.js`, `aura.setLightning`); levels 15-24 have flames and sparks only
- Map bosses (`BOSSES` in `engine/enemies.js`, spawn rule in `step()` of `engine/game.js`): each stage (every 8 fights) has a 5% chance (`BOSS_CHANCE` in `engine/boss.js`) that its 8th fight is the map's boss: same bodies as normal monsters, drawn 1.5x by CSS size (`.enemy.boss`, not `transform`, because the engine positions with `translateX`), a gold crown (`drawCrown`, bodies return `head`), gold name tag, about 5x HP, 2x hit on the hero. The roll is made once per stage (`state.bossRoll`, keyed by map + `floor(kills / 8)`) when `kills % 8 + enemies alive` first reaches 7; on a hit only the boss spawns (so it is always the stage-clearing kill, also with saved `kills` mid-map); on a miss normal monsters keep spawning and the stage clears at 8 kills. Sleep/wake never re-rolls. Test seam: `globalThis.__cbhBossChance` (renderer JS only, never settings/IPC); damage dealt to it is kept per map (`bossHpFrac`) so `sleep()` does not reset it. Killing it calls `hooks.onBossDefeated(id)` (`useGameEngine`), `aura.burst()` and the usual `nextMap()`. To add or change a boss edit `BOSSES` and keep `isBossId` in `main/main.js` in sync
- Boss trophies: `workspace.trophies` (`{ "boss:<map>": { count, firstAt } }`, filled by `load()` for old files). `App.tsx` `onBossDefeated` -> `SettingsContext.addTrophy` (local first) -> `bar.addTrophy` -> `workspace:trophy` (validates the id) -> `settings.addTrophy`. Trophies are rare: `load()` ran a one-time reset (`migrations.trophyResetV1` in settings.json, flushed at once; `settings:set` drops `migrations`). Shown by `components/panel/inventory/Trophies.tsx` (portrait drawn once with `createMonster`)
- Crits and combo (`engine/game.js`): `rollDamage` applies +5% per combo step (kills less than `COMBO_MS` apart, max `COMBO_MAX` steps) and a crit (`critChance(spd)`, x2, orange `.damage.crit`); the `div.combo` label is engine-owned, removed in `destroy()`, reset by `sleep()`. Engine only, nothing is persisted
- Stat cards (Status tab) show HP/ATK/DEF/SPD as a percentage of full, `vigorPct` = 100 - context used (`lib/leveling.ts`): 100% on a fresh context, draining as it fills, back to 100% on New session. Display only; combat uses the base stats

**Add a new map**:
- Define in `engine/scene.js` (draw layers, particles)
- Add to the `BACKGROUNDS` array in `engine/heroes.js`; add monsters to `ENEMY_TYPES` in `engine/enemies.js`
- Hero progresses through maps via kills (`KILLS_PER_MAP` in `engine/game.js`)

**Debug agent spawning**:
- Is the file really under `.claude/agents/` (project or `~/.claude/agents/`)? `findDefinition` in `main/agent-definitions.js` is the gate; `parseAgentInvocation` in `lib/agents.ts` is the parser
- Verify `useAgents` receives events via `bar.onAgentEvent`
- Check agents.js for process spawning errors
- Minions (one spirit wisp per agent) are rendered by `components/strip/Minions.tsx`, which anchors every wisp at the hero's body (chest height); each agent's wisp orbits the body on its own period and phase (`--orbit-*` CSS variables, `wisp-orbit` animation, passing behind and in front of the hero); `Minions` also tells the engine which agents are working (`setAllies`, `setMinionElements`) so it can fire projectiles from the wisps (position read at the moment of the shot)

**Run Claude manually for this project**:
```bash
claude -p --output-format stream-json <<EOF
Analyze the code and suggest improvements.
EOF
```

## File Responsibilities

| Path | Purpose |
|------|---------|
| `main/main.js` | Electron window, tray, IPC, panel management |
| `main/claude.js` | Claude subprocess, event parsing |
| `main/agents.js` | Concurrent agent processes |
| `main/agent-definitions.js` | Reads the agent definitions under `.claude/agents/` |
| `main/command-catalog.js` | Lists agents plus Claude's own commands (built-ins, skills, custom commands) for the "/" popup |
| `main/frontmatter.js` | Reads name / description / argument-hint from a markdown header |
| `main/settings.js` | State persistence, workspace/agent data |
| `main/preload.js` | Secure IPC bridge (`window.bar`), subscriptions return unsubscribe |
| `renderer/App.tsx` | Composition root: wires hooks to components |
| `renderer/context/SettingsContext.tsx` | Renderer copy of settings; local-first updates + persistence |
| `renderer/hooks/*` | IPC events, run/agent/chat state, window drag/resize, panel |
| `renderer/components/*` | Presentational React UI (strip, panel, inventory, common) |
| `renderer/engine/game.js` | Hero state machine, enemy spawn/death, stage progression |
| `renderer/engine/sprite.js` | Hero drawing and animation (expensive canvas ops) |
| `renderer/engine/scene.js` | Map rendering, parallax, particles |
| `renderer/engine/heroes.js` | Deterministic hero generation from seed, map list |
| `renderer/engine/enemies.js` | Monster catalogue per map (goblin, skeleton, orc, imp) and the shared animated sprite rig (walk / fight / idle) |
| `renderer/types.ts` | Shared TypeScript types, incl. the `window.bar` bridge contract |
| `renderer/lib/*` | Pure helpers: leveling, format, agent rules, models, hero cache |
| `renderer/styles/styles.css` | Theming (light/dark), component styling, animations |
| `vite.config.mjs` | Bundles the renderer into `dist/renderer` |
| `tsconfig.json` | Strict type checking for `src/renderer` (no emit; Vite builds) |

## Notes for Future Work

- **Minion animations**: Currently static pixels. Could animate with sprite-sheet (walk, attack, hurt)
- **Agent output formatting**: Currently minimal (name + status). Could show live token usage, tool calls
- **Performance**: Sprite outline generation (getImageData) is the hottest path; consider pre-caching or shader-based approach
- **Test coverage**: No tests currently; `lib/` is pure and easy to unit test (leveling, agent rules), then hooks
- **Security**: main.js + preload.js are the attack surface; the renderer is sandboxed with a strict CSP (`script-src 'self'`), so bundle everything, no inline scripts or CDN assets
