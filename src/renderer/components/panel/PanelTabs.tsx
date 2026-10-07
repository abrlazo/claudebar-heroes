import { TABS } from '../../hooks/usePanel';
import type { TabName } from '../../hooks/usePanel';
import type { DragProps } from '../../hooks/useWindowDrag';

/** Panel header: tab buttons, the Ask shortcut and close. Also a drag handle. */
export function PanelTabs({ tab, onTab, onClose, dragProps }: { tab: TabName; onTab: (tab: TabName) => void; onClose: () => void; dragProps: DragProps }) {
  return (
    <header className="panel-tabs" {...dragProps}>
      <button className={`tab${tab === TABS.PROJECT ? ' active' : ''}`} onClick={() => onTab(TABS.PROJECT)}>Expedition</button>
      <button className={`tab${tab === TABS.INVENTORY ? ' active' : ''}`} onClick={() => onTab(TABS.INVENTORY)}>Status</button>
      <span className="spacer" />
      <button id="ask-tab" className={tab === TABS.ASK ? 'active' : ''} title="Ask Claude" onClick={() => onTab(TABS.ASK)}>Ask</button>
      <button id="close-panel" title="Close" onClick={onClose}>✕</button>
    </header>
  );
}
