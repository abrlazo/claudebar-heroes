#!/usr/bin/env python3

"""
Animated Background Generator for Claudebar Heroes
Creates looping GIF backgrounds in different themes

Usage:
    python3 generate-backgrounds.py

Or with imageio:
    pip install pillow imageio
    python3 generate-backgrounds.py
"""

import math
import os
import random

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'backgrounds')

try:
    from PIL import Image, ImageDraw
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    print("❌ Pillow not installed. Install with: pip install pillow imageio")

def create_lava_gif():
    """Create animated lava background"""
    if not PILLOW_AVAILABLE:
        return

    print("🌋 Creating Lava background GIF...")
    frames = []

    for frame in range(20):
        # Create image with dark background
        img = Image.new('RGB', (400, 200), color='#1a0a0a')
        draw = ImageDraw.Draw(img, 'RGBA')

        # Background gradient (dark brown)
        for y in range(200):
            r = int(58 * (1 - y/200) + 26 * (y/200))
            g = int(42 * (1 - y/200) + 10 * (y/200))
            b = int(42 * (1 - y/200) + 10 * (y/200))
            draw.line([(0, y), (400, y)], fill=(r, g, b))

        # Draw lava waves
        for i in range(5):
            points = []
            base_y = 60 + math.sin(frame * 0.3 + i) * 20 + i * 20

            for x in range(0, 401, 20):
                wave_y = base_y + math.sin((x + frame * 5) * 0.02) * 10
                points.append((x, int(wave_y)))

            # Close the shape
            points.append((400, 200))
            points.append((0, 200))

            # Draw filled lava
            draw.polygon(points, fill='#ff4500', outline='#ff6b35')

        # Add glow overlay
        draw.rectangle([(0, 0), (400, 200)], fill=(255, 100, 0, 20))

        frames.append(img)

    # Save as GIF
    frames[0].save(
        os.path.join(OUT_DIR, 'bg-lava.gif'),
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0
    )
    print("✅ Created bg-lava.gif")

def create_snow_gif():
    """Create animated snowy background"""
    if not PILLOW_AVAILABLE:
        return

    print("❄️  Creating Snowy background GIF...")
    frames = []

    # Initialize snowflakes
    snowflakes = []
    for _ in range(30):
        snowflakes.append({
            'x': random.random() * 400,
            'y': random.random() * 200,
            'speed': random.random() * 0.5 + 0.2,
            'size': random.random() * 2 + 1
        })

    for frame in range(20):
        img = Image.new('RGB', (400, 200))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Sky gradient
        for y in range(150):
            r = int(179 + (230 - 179) * (y/150))
            g = int(217 + (242 - 217) * (y/150))
            b = int(255 + (255 - 255) * (y/150))
            draw.line([(0, y), (400, y)], fill=(r, g, b))

        # Snow ground
        draw.rectangle([(0, 150), (400, 200)], fill='#ffffff')

        # Draw snowflakes
        for flake in snowflakes:
            flake['y'] += flake['speed']
            if flake['y'] > 200:
                flake['y'] = -5
                flake['x'] = random.random() * 400

            x, y = int(flake['x']), int(flake['y'])
            size = int(flake['size'])
            draw.ellipse(
                [(x - size, y - size), (x + size, y + size)],
                fill='#ffffff'
            )

        frames.append(img)

    frames[0].save(
        os.path.join(OUT_DIR, 'bg-snowy.gif'),
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0
    )
    print("✅ Created bg-snowy.gif")

def create_desert_gif():
    """Create animated desert background"""
    if not PILLOW_AVAILABLE:
        return

    print("🏜️  Creating Desert background GIF...")
    frames = []

    for frame in range(20):
        img = Image.new('RGB', (400, 200))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Sky gradient
        for y in range(150):
            r = int(255 * (1 - y/150) + 212 * (y/150))
            g = int(179 * (1 - y/150) + 165 * (y/150))
            b = int(71 * (1 - y/150) + 65 * (y/150))
            draw.line([(0, y), (400, y)], fill=(r, g, b))

        # Sand
        draw.rectangle([(0, 150), (400, 200)], fill='#daa520')

        # Draw sand dunes
        for i in range(3):
            points = []
            for x in range(0, 401, 20):
                y = 140 + math.sin((x + frame * 2) * 0.01 + i * 2) * 15 + i * 20
                points.append((x, int(y)))

            points.append((400, 200))
            points.append((0, 200))

            color = (212, 165, 116) if i == 0 else (200, 150, 100)
            draw.polygon(points, fill=color)

        # Sun
        draw.ellipse([(320, 10), (380, 70)], fill='#ff8c00')

        frames.append(img)

    frames[0].save(
        os.path.join(OUT_DIR, 'bg-desert.gif'),
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0
    )
    print("✅ Created bg-desert.gif")

def create_forest_gif():
    """Create animated forest background"""
    if not PILLOW_AVAILABLE:
        return

    print("🌲 Creating Forest background GIF...")
    frames = []

    for frame in range(20):
        img = Image.new('RGB', (400, 200))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Sky gradient
        for y in range(200):
            r = int(135 + (224 - 135) * (y/200))
            g = int(206 + (246 - 206) * (y/200))
            b = int(235 + (255 - 235) * (y/200))
            draw.line([(0, y), (400, y)], fill=(r, g, b))

        # Trees (background)
        for i in range(3):
            x = i * 150 + (frame % 5) * 2
            # Trunk
            draw.rectangle([(x - 5, 100), (x + 5, 200)], fill='#2d5a2d')
            # Tree top
            draw.polygon([(x, 80), (x - 20, 110), (x + 20, 110)], fill='#2d5a2d')

        # Grass
        draw.rectangle([(0, 140), (400, 200)], fill='#228b22')

        # Animated grass
        for x in range(0, 400, 10):
            bend = math.sin((x + frame * 3) * 0.05) * 3
            draw.rectangle(
                [(x, int(135 + bend)), (x + 8, int(143 + bend))],
                fill='#32cd32'
            )

        frames.append(img)

    frames[0].save(
        os.path.join(OUT_DIR, 'bg-forest.gif'),
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0
    )
    print("✅ Created bg-forest.gif")

def create_night_gif():
    """Create animated night/space background"""
    if not PILLOW_AVAILABLE:
        return

    print("🌙 Creating Night/Space background GIF...")
    frames = []

    # Initialize stars
    stars = []
    for _ in range(40):
        stars.append({
            'x': random.random() * 400,
            'y': random.random() * 150,
            'brightness': random.random(),
            'twinkle_speed': random.random() * 0.05 + 0.02
        })

    for frame in range(20):
        img = Image.new('RGB', (400, 200))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Space background gradient
        for y in range(200):
            if y < 100:
                r = int(10 * (1 - y/100) + 26 * (y/100))
                g = int(10 * (1 - y/100) + 10 * (y/100))
                b = int(26 * (1 - y/100) + 58 * (y/100))
            else:
                r = int(26 + (10 - 26) * ((y-100)/100))
                g = int(10 + (10 - 10) * ((y-100)/100))
                b = int(58 + (10 - 58) * ((y-100)/100))
            draw.line([(0, y), (400, y)], fill=(r, g, b))

        # Draw twinkling stars
        for star in stars:
            star['brightness'] = math.sin(frame * star['twinkle_speed']) * 0.5 + 0.5
            alpha = int(255 * star['brightness'])
            draw.ellipse(
                [(star['x'] - 2, star['y'] - 2), (star['x'] + 2, star['y'] + 2)],
                fill=(255, 255, 255, alpha)
            )

        # Moon
        moon_x, moon_y = 70, 50
        draw.ellipse([(moon_x - 25, moon_y - 25), (moon_x + 25, moon_y + 25)], fill='#ffeb3b')
        # Moon glow
        draw.ellipse(
            [(moon_x - 35, moon_y - 35), (moon_x + 35, moon_y + 35)],
            fill=(255, 235, 59, 50)
        )

        # Ground
        draw.rectangle([(0, 160), (400, 200)], fill='#0a0a0a')

        frames.append(img)

    frames[0].save(
        os.path.join(OUT_DIR, 'bg-night.gif'),
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0
    )
    print("✅ Created bg-night.gif")

def main():
    if not PILLOW_AVAILABLE:
        print("\n❌ Pillow/PIL not installed")
        print("📦 Install with:")
        print("   pip install pillow imageio")
        return

    print("🎮 Claudebar Heroes - Background Generator\n")

    try:
        create_lava_gif()
        create_snow_gif()
        create_desert_gif()
        create_forest_gif()
        create_night_gif()

        print("\n🎉 All background GIFs created successfully!")
        print("\nGenerated files:")
        print("  ✅ bg-lava.gif")
        print("  ✅ bg-snowy.gif")
        print("  ✅ bg-desert.gif")
        print("  ✅ bg-forest.gif")
        print("  ✅ bg-night.gif")
        print("\nSize: 400x200px (Taskbar Hero dimensions)")
        print("Format: Animated GIF")
        print("Loop: Continuous")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == '__main__':
    main()
