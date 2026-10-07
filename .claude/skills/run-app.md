---
name: run-app
description: Start the Claudebar Heroes app for testing
---

# Run the App

When asked to "run", "start", "test in the app", or to see a feature working:

1. Run `npm start` or `npm run dev` (with DevTools)
2. Wait for the window to appear
3. The app opens at the bottom-right corner of your screen
4. Test the feature mentioned
5. Report what works/breaks

If the app doesn't start:
- Check that Node 20+ is installed
- Ensure Claude Code CLI is installed and logged in (`claude` works in terminal)
- Check the terminal output for errors
- If "Claude not found", set `CLAUDE_BIN=/path/to/claude` and retry

## Common Testing Flows

**Testing themes:**
- Click "Heroes & Maps" tab
- Toggle "Theme" dropdown between Dark/Light
- Verify colors invert and text is readable

**Testing agent spawning:**
- Send a prompt containing "agents", "workflow", or "parallel"
- Watch minions spawn around the hero
- Click agent tabs to view each agent's output
- Verify agents complete and minions animate out

**Testing panel resize:**
- Click 💬 to open chat panel
- Hover over bottom edge of panel (should see gradient highlight)
- Drag up/down to resize
- Close and reopen panel to verify height persists

**Testing workspace switching:**
- Click the project dropdown (📁)
- Select "＋ Import project..." and choose a folder
- A new hero spawns
- Switch back to previous project (hero and chat log swap)
