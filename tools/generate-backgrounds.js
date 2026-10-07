#!/usr/bin/env node

/**
 * Animated Background Generator for Claudebar Heroes
 * Creates looping GIF backgrounds in different themes
 *
 * Usage:
 * 1. Install: npm install gif-encoder
 * 2. Run: node generate-backgrounds.js
 */

const fs = require('fs');
const path = require('path');

// Try to use GifEncoder if available
let GifEncoder;
try {
  GifEncoder = require('gif-encoder');
} catch (e) {
  console.log('gif-encoder not installed. Attempting alternatives...');
}

// If gif-encoder not available, try gif-writer or provide Canvas-based solution
function createLavaGif() {
  if (!GifEncoder) {
    console.log('⚠️ gif-encoder not available - creating as HTML instead');
    return;
  }

  console.log('🌋 Creating Lava background GIF...');

  const gif = new GifEncoder(400, 200);
  gif.setDelay(50);
  gif.setQuality(10);
  gif.render();

  // Create 20 frames of lava animation
  for (let frame = 0; frame < 20; frame++) {
    const canvas = gif.canvas;
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, '#3a2a2a');
    gradient.addColorStop(1, '#1a0a0a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 200);

    // Lava waves
    ctx.fillStyle = '#ff4500';
    for (let i = 0; i < 5; i++) {
      const y = 60 + Math.sin(frame * 0.3 + i) * 20 + i * 20;
      ctx.beginPath();
      for (let x = 0; x <= 400; x += 20) {
        const waveY = y + Math.sin((x + frame * 5) * 0.02) * 10;
        if (x === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.lineTo(400, 200);
      ctx.lineTo(0, 200);
      ctx.closePath();
      ctx.fill();
    }

    // Glow effect
    ctx.fillStyle = 'rgba(255, 100, 0, 0.3)';
    ctx.fillRect(0, 0, 400, 200);

    gif.addFrame();
  }

  gif.write(path.join(__dirname, '..', 'assets', 'backgrounds', 'bg-lava.gif'));
  console.log('✅ Created bg-lava.gif');
}

function createSnowGif() {
  console.log('❄️ Creating Snowy background GIF...');

  const gif = new GifEncoder(400, 200);
  gif.setDelay(50);
  gif.setQuality(10);
  gif.render();

  // Snowflakes
  const snowflakes = [];
  for (let i = 0; i < 30; i++) {
    snowflakes.push({
      x: Math.random() * 400,
      y: Math.random() * 200,
      speed: Math.random() * 0.5 + 0.2,
      size: Math.random() * 2 + 1
    });
  }

  for (let frame = 0; frame < 20; frame++) {
    const canvas = gif.canvas;
    const ctx = canvas.getContext('2d');

    // Sky gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, '#b3d9ff');
    gradient.addColorStop(1, '#e6f2ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 200);

    // Snow ground
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 150, 400, 50);

    // Draw and animate snowflakes
    ctx.fillStyle = '#ffffff';
    for (let flake of snowflakes) {
      flake.y += flake.speed;
      if (flake.y > 200) flake.y = -5;

      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
      ctx.fill();
    }

    gif.addFrame();
  }

  gif.write(path.join(__dirname, '..', 'assets', 'backgrounds', 'bg-snowy.gif'));
  console.log('✅ Created bg-snowy.gif');
}

function createDesertGif() {
  console.log('🏜️ Creating Desert background GIF...');

  const gif = new GifEncoder(400, 200);
  gif.setDelay(50);
  gif.setQuality(10);
  gif.render();

  for (let frame = 0; frame < 20; frame++) {
    const canvas = gif.canvas;
    const ctx = canvas.getContext('2d');

    // Sky gradient
    const skyGradient = ctx.createLinearGradient(0, 0, 0, 150);
    skyGradient.addColorStop(0, '#ffb347');
    skyGradient.addColorStop(1, '#ffd699');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, 400, 150);

    // Sand
    ctx.fillStyle = '#daa520';
    ctx.fillRect(0, 150, 400, 50);

    // Dunes
    ctx.fillStyle = '#d4a574';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let x = 0; x <= 400; x += 20) {
        const y = 140 + Math.sin((x + frame * 2) * 0.01 + i * 2) * 15 + i * 20;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(400, 200);
      ctx.lineTo(0, 200);
      ctx.closePath();
      ctx.fill();
    }

    // Sun
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath();
    ctx.arc(350, 40, 30, 0, Math.PI * 2);
    ctx.fill();

    gif.addFrame();
  }

  gif.write(path.join(__dirname, '..', 'assets', 'backgrounds', 'bg-desert.gif'));
  console.log('✅ Created bg-desert.gif');
}

function createForestGif() {
  console.log('🌲 Creating Forest background GIF...');

  const gif = new GifEncoder(400, 200);
  gif.setDelay(50);
  gif.setQuality(10);
  gif.render();

  for (let frame = 0; frame < 20; frame++) {
    const canvas = gif.canvas;
    const ctx = canvas.getContext('2d');

    // Sky
    const skyGradient = ctx.createLinearGradient(0, 0, 0, 200);
    skyGradient.addColorStop(0, '#87ceeb');
    skyGradient.addColorStop(1, '#e0f6ff');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, 400, 200);

    // Trees (background)
    ctx.fillStyle = '#2d5a2d';
    for (let i = 0; i < 3; i++) {
      const x = i * 150 + (frame % 5) * 2;
      ctx.fillRect(x - 5, 100, 10, 100);
      ctx.beginPath();
      ctx.moveTo(x, 80);
      ctx.lineTo(x - 20, 110);
      ctx.lineTo(x + 20, 110);
      ctx.closePath();
      ctx.fill();
    }

    // Grass
    ctx.fillStyle = '#228b22';
    ctx.fillRect(0, 140, 400, 60);

    // Grass animation
    ctx.fillStyle = '#32cd32';
    for (let x = 0; x < 400; x += 10) {
      const bend = Math.sin((x + frame * 3) * 0.05) * 3;
      ctx.fillRect(x, 135 + bend, 8, 8);
    }

    gif.addFrame();
  }

  gif.write(path.join(__dirname, '..', 'assets', 'backgrounds', 'bg-forest.gif'));
  console.log('✅ Created bg-forest.gif');
}

function createNightGif() {
  console.log('🌙 Creating Night/Space background GIF...');

  const gif = new GifEncoder(400, 200);
  gif.setDelay(50);
  gif.setQuality(10);
  gif.render();

  // Stars
  const stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({
      x: Math.random() * 400,
      y: Math.random() * 150,
      brightness: Math.random(),
      twinkleSpeed: Math.random() * 0.05 + 0.02
    });
  }

  for (let frame = 0; frame < 20; frame++) {
    const canvas = gif.canvas;
    const ctx = canvas.getContext('2d');

    // Space background
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, '#0a0a1a');
    gradient.addColorStop(0.5, '#1a0a3a');
    gradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 200);

    // Stars with twinkling
    ctx.fillStyle = '#ffffff';
    for (let star of stars) {
      star.brightness = Math.sin(frame * star.twinkleSpeed) * 0.5 + 0.5;
      ctx.globalAlpha = star.brightness;
      ctx.beginPath();
      ctx.arc(star.x, star.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(70, 50, 25, 0, Math.PI * 2);
    ctx.fill();

    // Moon glow
    ctx.fillStyle = 'rgba(255, 235, 59, 0.2)';
    ctx.beginPath();
    ctx.arc(70, 50, 35, 0, Math.PI * 2);
    ctx.fill();

    // Ground (dark)
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 160, 400, 40);

    gif.addFrame();
  }

  gif.write(path.join(__dirname, '..', 'assets', 'backgrounds', 'bg-night.gif'));
  console.log('✅ Created bg-night.gif');
}

// Main execution
if (!GifEncoder) {
  console.log('❌ gif-encoder not installed');
  console.log('\n📦 Install with:');
  console.log('   npm install gif-encoder');
  console.log('\nThen run: node generate-backgrounds.js\n');
  console.log('⚠️ Creating HTML preview instead...\n');

  // Create HTML preview
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Claudebar Heroes - Background Previews</title>
  <style>
    body { background: #1a1a2e; color: white; font-family: monospace; padding: 20px; }
    h1 { color: #667eea; }
    .backgrounds { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; }
    .bg-preview { border: 2px solid #667eea; border-radius: 10px; overflow: hidden; }
    canvas { display: block; }
    h3 { margin: 0; padding: 10px; background: #667eea; }
  </style>
</head>
<body>
  <h1>🎮 Claudebar Heroes - Background Animations</h1>
  <p>These backgrounds animate in-game (400x200px)</p>

  <div class="backgrounds">
    <div class="bg-preview"><h3>🌋 Lava</h3><canvas id="lava" width="400" height="200"></canvas></div>
    <div class="bg-preview"><h3>❄️ Snowy</h3><canvas id="snowy" width="400" height="200"></canvas></div>
    <div class="bg-preview"><h3>🏜️ Desert</h3><canvas id="desert" width="400" height="200"></canvas></div>
    <div class="bg-preview"><h3>🌲 Forest</h3><canvas id="forest" width="400" height="200"></canvas></div>
    <div class="bg-preview"><h3>🌙 Night</h3><canvas id="night" width="400" height="200"></canvas></div>
  </div>

  <script>
    // Lava animation
    const lavaCanvas = document.getElementById('lava');
    const lavaCtx = lavaCanvas.getContext('2d');
    let lavaFrame = 0;
    function drawLava() {
      const gradient = lavaCtx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, '#3a2a2a');
      gradient.addColorStop(1, '#1a0a0a');
      lavaCtx.fillStyle = gradient;
      lavaCtx.fillRect(0, 0, 400, 200);

      lavaCtx.fillStyle = '#ff4500';
      for (let i = 0; i < 5; i++) {
        const y = 60 + Math.sin(lavaFrame * 0.3 + i) * 20 + i * 20;
        lavaCtx.beginPath();
        for (let x = 0; x <= 400; x += 20) {
          const waveY = y + Math.sin((x + lavaFrame * 5) * 0.02) * 10;
          if (x === 0) lavaCtx.moveTo(x, waveY);
          else lavaCtx.lineTo(x, waveY);
        }
        lavaCtx.lineTo(400, 200);
        lavaCtx.lineTo(0, 200);
        lavaCtx.closePath();
        lavaCtx.fill();
      }

      lavaCtx.fillStyle = 'rgba(255, 100, 0, 0.3)';
      lavaCtx.fillRect(0, 0, 400, 200);

      lavaFrame++;
      requestAnimationFrame(drawLava);
    }
    drawLava();

    // Snowy animation
    const snowyCanvas = document.getElementById('snowy');
    const snowyCtx = snowyCanvas.getContext('2d');
    const snowflakes = [];
    for (let i = 0; i < 30; i++) {
      snowflakes.push({
        x: Math.random() * 400,
        y: Math.random() * 200,
        speed: Math.random() * 0.5 + 0.2,
        size: Math.random() * 2 + 1
      });
    }
    function drawSnow() {
      const gradient = snowyCtx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, '#b3d9ff');
      gradient.addColorStop(1, '#e6f2ff');
      snowyCtx.fillStyle = gradient;
      snowyCtx.fillRect(0, 0, 400, 200);

      snowyCtx.fillStyle = '#ffffff';
      snowyCtx.fillRect(0, 150, 400, 50);

      snowyCtx.fillStyle = '#ffffff';
      for (let flake of snowflakes) {
        flake.y += flake.speed;
        if (flake.y > 200) flake.y = -5;
        snowyCtx.beginPath();
        snowyCtx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
        snowyCtx.fill();
      }

      requestAnimationFrame(drawSnow);
    }
    drawSnow();

    // Desert animation
    const desertCanvas = document.getElementById('desert');
    const desertCtx = desertCanvas.getContext('2d');
    let desertFrame = 0;
    function drawDesert() {
      const skyGradient = desertCtx.createLinearGradient(0, 0, 0, 150);
      skyGradient.addColorStop(0, '#ffb347');
      skyGradient.addColorStop(1, '#ffd699');
      desertCtx.fillStyle = skyGradient;
      desertCtx.fillRect(0, 0, 400, 150);

      desertCtx.fillStyle = '#daa520';
      desertCtx.fillRect(0, 150, 400, 50);

      desertCtx.fillStyle = '#d4a574';
      for (let i = 0; i < 3; i++) {
        desertCtx.beginPath();
        for (let x = 0; x <= 400; x += 20) {
          const y = 140 + Math.sin((x + desertFrame * 2) * 0.01 + i * 2) * 15 + i * 20;
          if (x === 0) desertCtx.moveTo(x, y);
          else desertCtx.lineTo(x, y);
        }
        desertCtx.lineTo(400, 200);
        desertCtx.lineTo(0, 200);
        desertCtx.closePath();
        desertCtx.fill();
      }

      desertCtx.fillStyle = '#ff8c00';
      desertCtx.beginPath();
      desertCtx.arc(350, 40, 30, 0, Math.PI * 2);
      desertCtx.fill();

      desertFrame++;
      requestAnimationFrame(drawDesert);
    }
    drawDesert();

    // Forest animation
    const forestCanvas = document.getElementById('forest');
    const forestCtx = forestCanvas.getContext('2d');
    let forestFrame = 0;
    function drawForest() {
      const skyGradient = forestCtx.createLinearGradient(0, 0, 0, 200);
      skyGradient.addColorStop(0, '#87ceeb');
      skyGradient.addColorStop(1, '#e0f6ff');
      forestCtx.fillStyle = skyGradient;
      forestCtx.fillRect(0, 0, 400, 200);

      forestCtx.fillStyle = '#2d5a2d';
      for (let i = 0; i < 3; i++) {
        const x = i * 150 + (forestFrame % 5) * 2;
        forestCtx.fillRect(x - 5, 100, 10, 100);
        forestCtx.beginPath();
        forestCtx.moveTo(x, 80);
        forestCtx.lineTo(x - 20, 110);
        forestCtx.lineTo(x + 20, 110);
        forestCtx.closePath();
        forestCtx.fill();
      }

      forestCtx.fillStyle = '#228b22';
      forestCtx.fillRect(0, 140, 400, 60);

      forestCtx.fillStyle = '#32cd32';
      for (let x = 0; x < 400; x += 10) {
        const bend = Math.sin((x + forestFrame * 3) * 0.05) * 3;
        forestCtx.fillRect(x, 135 + bend, 8, 8);
      }

      forestFrame++;
      requestAnimationFrame(drawForest);
    }
    drawForest();

    // Night animation
    const nightCanvas = document.getElementById('night');
    const nightCtx = nightCanvas.getContext('2d');
    const stars = [];
    for (let i = 0; i < 40; i++) {
      stars.push({
        x: Math.random() * 400,
        y: Math.random() * 150,
        brightness: Math.random(),
        twinkleSpeed: Math.random() * 0.05 + 0.02
      });
    }
    let nightFrame = 0;
    function drawNight() {
      const gradient = nightCtx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, '#0a0a1a');
      gradient.addColorStop(0.5, '#1a0a3a');
      gradient.addColorStop(1, '#0a0a0a');
      nightCtx.fillStyle = gradient;
      nightCtx.fillRect(0, 0, 400, 200);

      nightCtx.fillStyle = '#ffffff';
      for (let star of stars) {
        star.brightness = Math.sin(nightFrame * star.twinkleSpeed) * 0.5 + 0.5;
        nightCtx.globalAlpha = star.brightness;
        nightCtx.beginPath();
        nightCtx.arc(star.x, star.y, 1.5, 0, Math.PI * 2);
        nightCtx.fill();
      }
      nightCtx.globalAlpha = 1;

      nightCtx.fillStyle = '#ffeb3b';
      nightCtx.beginPath();
      nightCtx.arc(70, 50, 25, 0, Math.PI * 2);
      nightCtx.fill();

      nightCtx.fillStyle = 'rgba(255, 235, 59, 0.2)';
      nightCtx.beginPath();
      nightCtx.arc(70, 50, 35, 0, Math.PI * 2);
      nightCtx.fill();

      nightCtx.fillStyle = '#0a0a0a';
      nightCtx.fillRect(0, 160, 400, 40);

      nightFrame++;
      requestAnimationFrame(drawNight);
    }
    drawNight();
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(__dirname, 'background-preview.html'), html);
  console.log('✅ Created background-preview.html - open in browser to see animations\n');

} else {
  // If gif-encoder is available, generate GIF files
  try {
    createLavaGif();
    createSnowGif();
    createDesertGif();
    createForestGif();
    createNightGif();

    console.log('\n🎉 All background GIFs created successfully!');
    console.log('\nGenerated files:');
    console.log('  - bg-lava.gif');
    console.log('  - bg-snowy.gif');
    console.log('  - bg-desert.gif');
    console.log('  - bg-forest.gif');
    console.log('  - bg-night.gif');
  } catch (error) {
    console.error('❌ Error creating GIFs:', error.message);
  }
}
