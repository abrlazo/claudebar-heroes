import type { PanelLayout } from '../types';

/** Smallest and largest panel height + gap the renderer will lay out (the same bounds main uses for the setting). */
export const MIN_PANEL_H = 300;
export const MAX_PANEL_H = 1000;

/** Main's layout event is trusted for authority, but its numbers and strings are still checked before they reach CSS. */
export function parseLayout(raw: unknown): PanelLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const side = o.side === 'above' || o.side === 'below' ? o.side : null;
  const drawerMode = o.drawerMode === 'left' || o.drawerMode === 'right' || o.drawerMode === 'overlay' ? o.drawerMode : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const panelH = num(o.panelH);
  const maxPanelH = num(o.maxPanelH);
  if (!side || !drawerMode || panelH === null || maxPanelH === null || typeof o.fixed !== 'boolean') return null;
  return {
    side, drawerMode, fixed: o.fixed,
    panelH: Math.max(0, Math.min(MAX_PANEL_H, panelH)),
    maxPanelH: Math.max(0, Math.min(MAX_PANEL_H, maxPanelH)),
  };
}

/** The panel's height + gap on screen: the saved setting, never more than the window holds. */
export function shownPanelH(setting: number | undefined, layout: PanelLayout): number {
  const wanted = Number.isFinite(setting) ? (setting as number) : 500;
  return Math.round(Math.max(0, Math.min(wanted, layout.maxPanelH)));
}
