# Claudebar Heroes - Background Assets 🎮

## Generated Backgrounds

5 animated background GIFs for different game environments, all **400x200px** (perfect for taskbar game dimensions).

### 📋 Background List

| Theme | File | Size | Description |
|-------|------|------|-------------|
| 🌋 Lava | `assets/backgrounds/bg-lava.gif` | 28K | Flowing lava with dark fire theme |
| ❄️ Snowy | `assets/backgrounds/bg-snowy.gif` | 20K | Falling snow with frozen landscape |
| 🏜️ Desert | `assets/backgrounds/bg-desert.gif` | 12K | Sandy dunes with orange sun |
| 🌲 Forest | `assets/backgrounds/bg-forest.gif` | 31K | Green trees with animated grass |
| 🌙 Night | `assets/backgrounds/bg-night.gif` | 39K | Starry space with twinkling stars |

---

## Features

✨ **All Backgrounds Include:**
- 20 animation frames
- Continuous looping
- 400x200px resolution (taskbar standard)
- Optimized file sizes
- Unique animations:
  - **Lava:** Flowing waves and glow
  - **Snowy:** Falling snowflakes
  - **Desert:** Moving sand dunes
  - **Forest:** Swaying grass
  - **Night:** Twinkling stars

---

## Integration Guide

### HTML5 Canvas / Web Game

```html
<img id="bg" src="bg-lava.gif" alt="Background">

<script>
  // Set background
  const bgImg = document.getElementById('bg');
  bgImg.style.width = '400px';
  bgImg.style.height = '200px';
</script>
```

### JavaScript (Phaser Framework)

```javascript
// In preload()
this.load.image('bg-lava', 'assets/bg-lava.gif');
this.load.image('bg-snowy', 'assets/bg-snowy.gif');
// ... etc

// In create()
const backgrounds = {
  lava: this.add.image(200, 100, 'bg-lava'),
  snowy: this.add.image(200, 100, 'bg-snowy'),
  desert: this.add.image(200, 100, 'bg-desert'),
  forest: this.add.image(200, 100, 'bg-forest'),
  night: this.add.image(200, 100, 'bg-night')
};

// Set as background
backgrounds.lava.setDepth(-1);
```

### React / Vue.js

```jsx
// React
import BgLava from './assets/bg-lava.gif';

function GameContainer() {
  const [bgTheme, setBgTheme] = useState('lava');
  
  return (
    <div className="game-container">
      <img 
        src={require(`./assets/bg-${bgTheme}.gif`)} 
        alt="Background"
        style={{ width: '400px', height: '200px' }}
      />
      {/* Game elements */}
    </div>
  );
}
```

### Godot Engine

```gdscript
extends CanvasLayer

func _ready():
    var bg = TextureRect.new()
    bg.texture = load("res://assets/bg_lava.gif")
    bg.custom_minimum_size = Vector2(400, 200)
    add_child(bg)
```

### Electron + HTML5 Canvas

```javascript
// In renderer process
const gameCanvas = document.getElementById('game');
const ctx = gameCanvas.getContext('2d');

const bgImg = new Image();
bgImg.src = './assets/bg-lava.gif';

bgImg.onload = () => {
  ctx.drawImage(bgImg, 0, 0, 400, 200);
};
```

---

## Customization

### Modify Background Colors

All backgrounds were generated with specific color schemes. To customize:

1. **Edit `generate-backgrounds.py`**
2. Change color hex values:
   ```python
   # Example: Change lava color
   draw.polygon(points, fill='#ff4500')  # Change this hex
   ```
3. Regenerate:
   ```bash
   python3 generate-backgrounds.py
   ```

### Color Palettes Used

**Lava Theme:**
- Foreground: `#ff4500` (Orange-Red)
- Glow: `#ff6b35` (Bright Orange)
- Background: `#3a2a2a` → `#1a0a0a` (Dark Brown)

**Snowy Theme:**
- Snow: `#ffffff` (White)
- Sky: `#b3d9ff` → `#e6f2ff` (Light Blue)
- Ground: `#ffffff` (White)

**Desert Theme:**
- Sky: `#ffb347` → `#ffd699` (Warm Orange)
- Sand: `#daa520` (Goldenrod)
- Dunes: `#d4a574` (Tan)
- Sun: `#ff8c00` (Dark Orange)

**Forest Theme:**
- Sky: `#87ceeb` → `#e0f6ff` (Sky Blue)
- Trees: `#2d5a2d` (Dark Green)
- Grass: `#228b22` → `#32cd32` (Green)

**Night Theme:**
- Space: `#0a0a1a` → `#1a0a3a` → `#0a0a0a` (Dark Blue/Purple)
- Stars: `#ffffff` (White)
- Moon: `#ffeb3b` (Yellow)
- Ground: `#0a0a0a` (Black)

---

## Performance Tips

### For Web Games:
```css
/* CSS for optimal background display */
.game-background {
  image-rendering: -webkit-optimize-contrast;
  image-rendering: pixelated;
  width: 400px;
  height: 200px;
  display: block;
}
```

### For Canvas-based Games:
```javascript
// Disable anti-aliasing for crisp GIFs
ctx.imageSmoothingEnabled = false;
ctx.imageSmoothingQuality = 'low';
```

### File Size Optimization:
All GIFs are already optimized, but if needed:
```bash
# Using ImageMagick (if installed)
convert bg-lava.gif -colors 256 bg-lava-compressed.gif

# Using GIFSICLE
gifsicle -O3 bg-lava.gif -o bg-lava-optimized.gif
```

---

## Dynamic Background Switching

### Example: Player selects difficulty level → different background

```javascript
const backgrounds = {
  easy: 'bg-forest.gif',      // Peaceful forest
  normal: 'bg-desert.gif',    // Standard difficulty
  hard: 'bg-lava.gif',        // Intense lava
  extreme: 'bg-night.gif'     // Challenging darkness
};

function setGameDifficulty(difficulty) {
  const bgFile = backgrounds[difficulty];
  gameElement.style.backgroundImage = `url('assets/${bgFile}')`;
}
```

### Example: Background for different zones/stages

```javascript
const stageBackgrounds = {
  1: 'bg-forest.gif',
  2: 'bg-desert.gif',
  3: 'bg-lava.gif',
  4: 'bg-snowy.gif',
  5: 'bg-night.gif',
  boss: 'bg-night.gif'
};

function loadStage(stageNumber) {
  const bg = stageBackgrounds[stageNumber];
  loadBackground(bg);
}
```

---

## File Structure

```
claudebar-heroes/
├── bg-lava.gif           (28K)  🌋
├── bg-snowy.gif          (20K)  ❄️
├── bg-desert.gif         (12K)  🏜️
├── bg-forest.gif         (31K)  🌲
├── bg-night.gif          (39K)  🌙
├── generate-backgrounds.py      (Generator script)
├── BACKGROUNDS.md               (This file)
└── background-preview.html      (Browser preview)
```

---

## Additional Themes You Can Generate

Want more backgrounds? Edit `generate-backgrounds.py` to add:

```python
def create_volcano_gif():
    """Volcano with erupting lava"""
    pass

def create_underwater_gif():
    """Ocean with bubbles and fish"""
    pass

def create_fire_gif():
    """Burning flames effect"""
    pass

def create_ice_gif():
    """Frozen icicles"""
    pass
```

---

## Resources

- **Total Size:** ~130KB (all 5 backgrounds combined)
- **Recommended Display:** 400x200px (fits taskbar perfectly)
- **Can Scale To:** Any size (recommend 2x or 4x for pixel-perfect scaling)
- **Format:** Animated GIF (universally supported)
- **FPS:** ~20 frames (50ms per frame)

---

## Troubleshooting

### GIF Not Animating?
- Ensure file is served with correct MIME type: `image/gif`
- Check browser compatibility (all modern browsers support animated GIFs)

### GIF Too Large?
- Use ImageMagick or GIFSICLE to compress further
- Reduce color palette from 256 to 128 colors

### Colors Look Wrong?
- Ensure color display is set to sRGB
- Check file wasn't converted to PNG by accident

---

**Ready to use in your Claudebar Heroes game!** 🚀
