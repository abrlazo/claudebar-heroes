# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Claudebar Heroes** is an Electron-based taskbar companion for Claude Code that visualizes Claude's work as a pixel-art RPG. The user's projects are "workspaces," each with a randomly-generated hero that levels up as Claude uses context tokens. When Claude works, monsters appear (one per tool call): goblins, skeletons, orcs and imps. They walk up, fight the hero, and get fought back. Every 8 kills triggers a stage clear and map progression.

Key recent features:
- **Themes**: Dark/Light mode toggle
- **Resizable panels**: Drag bottom edge to resize chat (300-1000px)
- **Multi-agent orchestration**: When prompts contain keywords ("agent", "workflow", "parallel"), Claude automatically spawns 1-3 agents that run concurrently, each with a minion visualization and separate chat tab

## Running the App

```bash
npm start        # vite build, then launch Electron
npm run dev      # same as start, but opens DevTools
npm run watch    # rebuild the React UI on save (then Status -> Restart App)
npm run typecheck # tsc --noEmit over src/renderer
npm run simulate  # build, then run 3 simulated agents against a fake claude and check the UI (tools/simulate-agents.mjs)
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

**agents.js** - Multi-agent orchestration (new)
- Manages concurrent Claude processes for parallel work
- Spawns up to 3 agents when prompt keywords detected
- Each agent tracks status, usage, session independently
- Agent tool calls also send named monsters at the hero; the HUD shows "N agents working…"

**settings.js** - Persistent state
- Workspaces (projects with hero seed, progress, Claude session)
- Agents per workspace (name, status, usage, session)
- User preferences (theme, panelHeight)
- Each workspace keeps separate chat log and hero state

**preload.js** - IPC bridge
- Exposes safe methods to renderer (no direct Node access)
- Methods: spawn/cancel agents, update settings, import/select workspaces, send prompts

### Renderer (`src/renderer/`)

React 19 + TypeScript + Vite (`strict`; run `npm run typecheck`). `engine/` stays plain JS (`allowJs`); `main/` is plain CommonJS JS. Shared types live in `types.ts` (settings, messages, events, the `window.bar` bridge). Import TS modules without extensions; engine imports keep `.js`. Layers, top to bottom (a layer only imports from layers below it):

- **`App.tsx`** - composition root: calls the hooks, passes props down. No UI of its own.
- **`components/`** - presentational React components (`strip/`, `panel/`, `panel/inventory/`, `common/`). Element ids/classes are kept stable because `styles/styles.css` targets them.
- **`hooks/`** - behaviour and IPC:
  - `useClaudeRun` - project chat run: Claude events -> saved messages (incl. thinking), live token usage, XP, hero reactions
  - `useAgents` - parallel agents: spawn, per-agent logs, minions, auto-remove
  - `useGeneralChat` - the Ask chat (in-memory, project-less)
  - `useGameEngine` - creates/destroys the canvas engine, returns a safe `game` facade
  - `usePanel`, `usePanelResize`, `useWindowDrag`, `useClickThrough`, `useStageStatus`, `useWorkspaceActions`, `useBridgeEvent`
- **`context/SettingsContext.tsx`** - renderer copy of settings.json; updates apply locally first, then persist via IPC
- **`engine/`** - framework-free game: `game.js` (state machine/loop), `scene.js`, `sprite.js`, `aura.js`, `prestige.js`, `heroes.js`, `enemies.js`, `minionSprite.js`. No React or IPC imports.
- **`lib/`** - pure helpers: `leveling`, `format`, `agents` (keyword rules), `models`, `heroCache`, `effects`, `bridge` (`window.bar`)

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

Agents are spawned via slash commands (e.g., `/agent`, `/workflow`). When triggered:

1. Main process spawns N concurrent Claude processes (1-3 based on prompt length)
2. Each agent gets:
   - Unique ID, name ("Agent 1", "Agent 2", etc.)
   - Spirit orb (minion) hovering around the main hero
   - Tab in agent tabs UI showing name + status
   - Independent chat log

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
  "activeId": "workspace-id",
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

**Add a feature**:
1. Identify which workspace/setting it affects (`main/settings.js`; renderer mirror in `context/SettingsContext.tsx`)
2. Put behaviour in a hook (`hooks/`), pure logic in `lib/`, and UI in a component (`components/`)
3. Style in `styles/styles.css`
4. Add an IPC handler in `main/main.js` if it needs the backend, and expose it in `main/preload.js`
5. Wire the hook into `App.tsx` and pass props down

**Modify hero behavior**:
- Hero visuals: `engine/sprite.js` (draw) + `engine/heroes.js` (generate from seed)
- Hero animation: `engine/game.js` (state machine) + `engine/sprite.js` (rendering)
- Sleep/wake: the hero is awake exactly while Claude or an agent is working. `App.tsx` drives it with one effect on `busy` (`game.wake()` / `game.sleep()`); don't guard `game.sleep()` with a ref in event handlers, the ref is stale until the next render and the hero never falls asleep
- Summoned characters (`findSummon`, `CHARACTERS` in `engine/heroes.js`): typing "summon <name>" in the project chat swaps the active project's hero (`useWorkspaceActions.summonHero`, `bar.rerollHero(id, seed)`) and is not sent to Claude. Famous characters (Darth Vader, Yoda, Gandalf, Goku, Batman, Link) have hand-built looks and stats and match anywhere in a message; any other name needs a short message starting with "summon" (max 4 words) and becomes a hero generated from `summon:<name>` wearing that name. Seeds come from `findSummon` only; the main process accepts just `secret:darth-vader` or `summon:<short plain name>` (`isSummonSeed` in `main/main.js`, keep in sync). To add a character, add an entry to `CHARACTERS` (names, quote, hero parts + colours + stats). Darth Vader also has a black helmet (`gear: 'vader'` in `sprite.js`) and a lightsaber whose red glow (`signatureGlow`) stays at every level
- XP thresholds: `levelFor`, `xpForLevel` in `lib/leveling.ts`
- Level prestige (`engine/prestige.js`): weapon glow from level 10, colour changes every 5 levels (10, 15, 20, ...); Super Saiyan-style aura from level 15 (lightning added from level 25), colour changes every 15 levels (15, 30, 45, ...; gold, blue, rose, purple, green, white). Palettes repeat. `App.tsx` passes the level to `game.configure({ level })`; the glow is drawn from the weapon's own pixels in `engine/sprite.js`; the aura (`engine/aura.js`: flame spikes, sparks, lightning, power-up burst) is drawn on `#aura-canvas` behind the hero and flares up while Claude works. Lightning only crackles from level 25 (`LIGHTNING_START` in `prestige.js`, `aura.setLightning`); levels 15-24 have flames and sparks only
- Stat cards (Status tab) show HP/ATK/DEF/SPD as a percentage of full, `vigorPct` = 100 - context used (`lib/leveling.ts`): 100% on a fresh context, draining as it fills, back to 100% on New session. Display only; combat uses the base stats

**Add a new map**:
- Define in `engine/scene.js` (draw layers, particles)
- Add to the `BACKGROUNDS` array in `engine/heroes.js`; add monsters to `ENEMY_TYPES` in `engine/enemies.js`
- Hero progresses through maps via kills (`KILLS_PER_MAP` in `engine/game.js`)

**Debug agent spawning**:
- Check AGENT_KEYWORDS in `lib/agents.ts`
- Verify `useAgents` receives events via `bar.onAgentEvent`
- Check agents.js for process spawning errors
- Minions (one spirit orb per agent) are rendered by `components/strip/Minions.tsx`, which owns their formation (a tight cluster around the hero: beside it and above its head, never overlapping); the engine only reads each slot (`setMinionElements`) to fire projectiles from it

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
| `main/agents.js` | Concurrent agent orchestration |
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
