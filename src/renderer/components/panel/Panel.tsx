import { PanelTabs } from './PanelTabs';
import { ProjectChat } from './ProjectChat';
import { AskChat } from './AskChat';
import { Inventory } from './inventory/Inventory';
import type { InventoryProps } from './inventory/Inventory';
import type { AskChatProps } from './AskChat';
import type { ProjectChatProps } from './ProjectChat';
import type { PanelState } from '../../hooks/usePanel';
import type { DragProps } from '../../hooks/useWindowDrag';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface PanelProps {
  panel: PanelState;
  dragProps: DragProps;
  resizeProps: { onMouseDown: (e: ReactMouseEvent) => void };
  project: ProjectChatProps;
  ask: AskChatProps;
  inventory: InventoryProps;
}
import { TABS } from '../../hooks/usePanel';
import type { TabName } from '../../hooks/usePanel';

/** The chat / inventory panel that opens from the strip. */
export function Panel({ panel, dragProps, resizeProps, project, ask, inventory }: PanelProps) {
  const visible = (name: TabName) => panel.open && panel.tab === name;
  return (
    <section id="panel" className={`interactive${panel.open ? '' : ' hidden'}`}>
      <PanelTabs tab={panel.tab} onTab={panel.setTab} onClose={() => panel.toggle(false)} dragProps={dragProps} />
      <ProjectChat visible={visible(TABS.PROJECT)} {...project} />
      <AskChat visible={visible(TABS.ASK)} {...ask} />
      <Inventory visible={visible(TABS.INVENTORY)} {...inventory} />
      <div id="panel-resize" className="panel-resize" {...resizeProps} />
    </section>
  );
}
