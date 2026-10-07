#!/usr/bin/env node

/**
 * SVG to PNG Converter for Claudebar Heroes
 *
 * Usage:
 * 1. Install dependencies: npm install svg2png
 * 2. Run: node convert-svg-to-png.js
 */

const fs = require('fs');
const path = require('path');

// Try using svg2png if available
try {
  const svg2png = require('svg2png');
  const SVGInjector = require('svg-injector');

  const characters = [
    { name: 'claudius-warrior', title: 'Claudius - Warrior' },
    { name: 'mystara-mage', title: 'Mystara - Mage' },
    { name: 'shadow-rogue', title: 'Shadow - Rogue' },
    { name: 'lumina-paladin', title: 'Lumina - Paladin' },
    { name: 'aether-ranger', title: 'Aether - Ranger' }
  ];

  async function convertAll() {
    for (const char of characters) {
      const inputFile = path.join(__dirname, '..', 'assets', 'heroes', `${char.name}.svg`);
      const outputFile = path.join(__dirname, '..', 'assets', 'heroes', `${char.name}.png`);

      try {
        const buffer = await svg2png({ input: inputFile });
        fs.writeFileSync(outputFile, buffer);
        console.log(`✅ Converted ${char.title} to PNG`);
      } catch (error) {
        console.error(`❌ Error converting ${char.title}:`, error.message);
      }
    }
  }

  convertAll();

} catch (error) {
  console.log('svg2png not available. Please install it:');
  console.log('npm install svg2png');
  console.log('\nAlternative methods to convert SVG to PNG:');
  console.log('1. Use online converter: https://convertio.co/svg-png/');
  console.log('2. Use ImageMagick: convert input.svg output.png');
  console.log('3. Use Inkscape: inkscape input.svg -o output.png');
  console.log('4. Right-click SVG in browser and save as PNG');
}
