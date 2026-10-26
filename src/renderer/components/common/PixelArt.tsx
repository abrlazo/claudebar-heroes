import { useEffect, useRef, useState } from 'react';
import type { PixelArtData } from '../../types';
import { scaleFor } from '../../lib/draw';

/**
 * A `/draw` sample on a canvas of w x h cells, scaled by a whole number and never smoothed. The data was
 * validated in main (cells are palette indexes, colours are `#rrggbb`); nothing here parses markup.
 */
export function PixelArt({ art, caption }: { art: PixelArtData; caption: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(() => scaleFor(192, art.w));

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, art.w, art.h);
    art.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        const color = art.palette[parseInt(ch, 16)];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }, [art]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return undefined;
    const update = () => setScale(scaleFor(el.clientWidth || 192, art.w));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [art.w]);

  return (
    <div className="pixel-art" ref={holder}>
      <canvas
        ref={canvas}
        className="pixel-art-canvas"
        width={art.w}
        height={art.h}
        style={{ width: art.w * scale, height: art.h * scale }}
        role="img"
        aria-label={caption}
      />
    </div>
  );
}
