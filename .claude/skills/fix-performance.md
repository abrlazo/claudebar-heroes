---
name: fix-performance
description: Fix identified memory leaks and performance bottlenecks
---

# Fix Performance Issues

This project has documented memory leaks and performance bottlenecks (see CLAUDE.md → Performance Issues & Constraints).

## Critical Issues to Fix (in order)

### 1. Event Listener Accumulation (renderer.js)
Files affected: `renderAgentTabs()`, `renderRoster()`, `renderMapPicker()`, settings controls

**Problem:** Event listeners added to DOM elements without cleanup. Each render call adds more listeners, causing memory to grow.

**Solution:**
- Cache DOM references or use event delegation
- Use `.replaceChildren()` correctly (it removes old listeners, but re-binding is expensive)
- Consider using single event listener on parent container instead of per-element listeners

**Lines:** 355-373, 702-730, 765-778

### 2. IPC Listener Registration Without Unsubscribe (renderer.js)
**Problem:** `bar.onClaudeEvent()`, `bar.onAgentEvent()`, `bar.onPanelSide()`, `bar.onTogglePanel()` register listeners that never unsubscribe.

**Solution:**
- Add unsubscribe/off methods to preload.js
- Call cleanup in window.beforeunload or app quit

**Lines:** 415, 471, 565, 627

### 3. ResizeObserver Never Disconnected (game.js)
**Problem:** Line 41 creates ResizeObserver but never calls `.disconnect()`

**Solution:**
```javascript
const resizeObserver = new ResizeObserver(() => scene.resize());
resizeObserver.observe(canvas);
// Store reference and call resizeObserver.disconnect() in cleanup
```

**Lines:** 41

### 4. Game Loop Sort Performance (game.js)
**Problem:** `state.enemies.sort((a, b) => a.x - b.x)` called every frame (line 172)

**Solution:**
- Memoize sort result; only resort when enemies array changes
- Or: skip sort if `enemies.length < 2`
- Consider if sorting is even necessary (is it visual or functional?)

**Lines:** 172

### 5. Expensive Canvas Operations (sprite.js)
**Problem:** `getImageData()` and `putImageData()` called every sprite render frame (lines 327-340)

**Solution:**
- Pre-render outline during hero generation, store in separate canvas
- Or: use CSS filters or WebGL for outline effect
- Cache the result since hero appearance is static per session

**Lines:** 327-340

## When Fixing

✓ Run the app with DevTools open (`npm run dev`) to monitor memory in Chrome DevTools
✓ Test workspace switching and agent spawning — these trigger heavy rendering
✓ Verify no console errors after fixes
✓ Check that performance issues are resolved (smooth 60fps, no memory growth)

## Testing

After fixes:
1. Open DevTools (Memory tab)
2. Switch workspaces 10 times — memory should stabilize, not grow
3. Spawn agents multiple times — minions should appear/disappear cleanly
4. Watch Performance tab during agent spawning — should see smooth 60fps
