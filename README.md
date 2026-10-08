# Claudebar Heroes

An Electron taskbar companion for [Claude Code](https://claude.com/claude-code) that shows Claude's work as a pixel-art RPG. A small strip above your taskbar or dock holds a hero, and a pop-up panel lets you chat with Claude. It is for people who use Claude Code and want to see what it is doing at a glance.

- **One hero per project.** Every imported project gets its own hero, generated from a seed.
- **Monsters for tool calls.** Each tool call Claude makes sends a monster at the hero.
- **Levels from tokens used.** The hero levels up as Claude uses tokens in that project.
- **Spirit orbs for agents.** Every agent you start appears as a glowing wisp orbiting the hero (calmer once it has finished).
- **Ask chat.** A project-less chat for quick questions.

## Requirements

- Node.js 22.12 or newer (required by the Vite and Electron versions in `package-lock.json`).
- The Claude Code CLI installed and logged in (`claude` works in your terminal). If it is not on your PATH, start the app with `CLAUDE_BIN=/path/to/claude npm start`.

## How to run

```bash
npm install
npm start
```

| Script | What it does |
|--------|--------------|
| `npm start` | Bundles the React UI with Vite, then launches Electron |
| `npm run dev` | Same as `start`, but opens DevTools |
| `npm run watch` | Rebuilds the UI on every save (then use Status -> Restart App) |
| `npm run build` | Bundles the UI into `dist/renderer` without launching |
| `npm run typecheck` | Runs `tsc --noEmit` over `src/renderer` |
| `npm run check` | Validates the character roster, hero-design allowlists, boss roll helpers (`tools/check-roster.mjs`) and that the level aura stays within the hero's body width (`tools/check-aura.mjs`) |
| `npm run simulate` | Builds, then drives an isolated copy of the app against a fake `claude` and checks the UI: `/<agent>` runs, chains, delegated agents, the `/` popup, `/plan`, map bosses, trophies, crits and combos, summoned heroes (`tools/simulate-agents.mjs`) and the aura pose (`tools/check-aura-ui.mjs`) |

Open the chat with the speech-bubble button on the strip or with `Cmd/Ctrl+Shift+Space`.

## How it works

- **Heroes and levels:** XP comes from tokens Claude uses in the project (cached context counts less); the HUD shows how full the context window is.
- **Monsters:** one per tool call (goblins, skeletons, orcs, imps); every 8 kills clears a stage and moves to the next map. Hits can crit and quick kills build a combo (`x3 COMBO`, up to +25% damage).
- **Bosses:** each stage has a rare chance (about 5%, roughly 1 in 20 stages) that its 8th fight is the map's boss: Grukk the Orc King in the forest, Khamun the Bone Pharaoh in the desert, Rimefang the Ice Tyrant on the snow map, Pyrax the Cinder Lord in the lava and Nyx the Goblin Queen at night. A boss is bigger, crowned, has a gold name tag and a wide health bar, about 5x the HP and hits twice as hard. If it does not appear, the stage clears at 8 kills as usual, and damage dealt to a boss survives the hero falling asleep.
- **Trophies:** beating a boss earns a trophy on the Status tab's shelf (five slots, one per map; locked slots show as "???" and defeated ones show how many times). Trophies are kept per project and are meant to be rare.
- **Wisps:** each running agent is a glowing wisp that orbits the hero's body in its own colour and fires at monsters; finished agents stay as calmer wisps until you close their tab.
- **Agent chains:** `/<agent> <task> && /<agent> [task]` (2 or 3 steps, every step a known agent) runs them one after another in the same project. A step with no task gets the previous agent's final message. A failed, stopped or closed step drops the rest; chains are not saved across restarts.
- **Agents:** type `/<agent-name> <task>` for any agent defined under `.claude/agents/` (for example `/reviewer check my last change`). It runs as its own Claude process (up to 4 at once) with its own orb, tab and chat. Skills, other slash commands and anything not in `.claude/agents/` are not agents and are sent to Claude as normal messages. Headless runs cannot ask for permission, so pick *Accept edits* or *Bypass perms* in the footer for agents that need tools like Bash.
- **Delegated agents:** when Claude itself hands work to one of the project's agents (its Agent tool), that agent also gets a tab and an orb, marked as running inside Claude's run. They are read-only (you cannot message them, Stop ends the whole run) and are not saved across restarts. Built-in agent types such as `Explore` stay ordinary tool lines.
- **Command suggestions:** typing `/` in the Expedition chat opens a popup of everything you can run: your agents, Claude's own commands (built-ins such as `/compact` or `/context`, skills, custom commands) and the app's own `/plan` and `summon`. Type to narrow it, Up/Down to move, Enter or Tab to pick, Esc to close. Commands that only work in the terminal (`/help`, `/doctor`...) are left out. `/plan [task]` switches the footer to *Plan only* and sends the task.
- **Ask chat:** an in-memory chat that is not tied to a project.
- **Summoning:** type `summon <name>` in the project chat to turn the project's hero into that character (Darth Vader, Yoda, Gandalf, Goku, Batman, Link and 14 more such as Naruto, Mario, Spider-Man and Pikachu are hand-built). Any other name asks Claude once (no tools, cheap model) to design a look from the allowed parts and colours; it is validated, saved and reused, and if it fails you get a generated hero.
- **Weapon glow:** from level 10 the weapon glows, with a new colour every 5 levels.
- **Aura:** from level 15 a flame aura hugs the hero's body (gold, blue, rose, purple, green, white, changing every 15 levels). Lightning joins it from level 25, it flares while Claude works, and it lies down along the hero's body when the hero sleeps.

The app runs Claude Code headlessly (`claude -p --output-format stream-json`), so it uses your existing login. Headless Claude cannot show permission prompts, so pick *Accept edits* or *Bypass permissions* in the panel if you want it to change files freely. See [CLAUDE.md](CLAUDE.md) for the architecture.

## Where data is saved

Projects, hero seeds, token usage, map progress and Claude session IDs are saved in `settings.json` in Electron's user-data folder (on macOS `~/Library/Application Support/claudebar-heroes/settings.json`). Nothing leaves your machine except the calls the Claude Code CLI makes itself.

## Project layout

```
claudebar-heroes/
├── src/
│   ├── main/            # Electron main process: window, tray, IPC, Claude and agent processes, settings
│   └── renderer/        # React + TypeScript UI, bundled by Vite
│       ├── components/  # presentational UI (strip, panel, inventory, common)
│       ├── hooks/       # behaviour and IPC
│       ├── context/     # renderer copy of settings
│       ├── engine/      # framework-free canvas game (heroes, monsters, maps, aura)
│       ├── lib/         # pure helpers
│       └── styles/      # CSS
├── assets/              # original hero SVGs and background GIFs
├── tools/               # asset generators, background preview, agent simulation
├── .claude/             # Claude Code agents and skills for this repo
├── vite.config.mjs      # builds src/renderer into dist/renderer
├── tsconfig.json        # strict type checking for the renderer
├── BACKGROUNDS.md       # notes on the background themes
└── CLAUDE.md            # architecture and contributor guidance
```

## Regenerating assets

```bash
python3 tools/generate-backgrounds.py   # needs Pillow; writes assets/backgrounds/*.gif
node tools/convert-svg-to-png.js        # needs svg2png; writes PNGs next to the SVGs
```

`tools/background-preview.html` previews the backgrounds in a browser.
