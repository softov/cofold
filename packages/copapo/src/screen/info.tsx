import type { RenderOutput, TextUIApp } from '@textui/core';
import { defineComponent, useApp, useStoreValue } from '@textui/core';
import { Column, Dialog } from '@textui/widgets';
import { INFO } from './state.js';

/** What the information overlay shows: a title and lines, as the command that opened it wrote them. */
export interface Info {
  title: string;
  lines: string[];
}

export interface InfoAction {
  id: string;
  label: string;
  run(): void;
}

const LAYER = 'papo.info';
/** Lines shown before the rest is folded into a count; a dialog is not a pager. */
const MAX_LINES = 40;
const WIDTH = 78;

/**
 * The one overlay behind `/status`, `/usage`, `/config`, `/help`, `/memory`: a dialog over `$/papo/info`.
 * `esc` closes it; an action, when the command gave one, is a button along the bottom.
 */
export const PapoInfo = defineComponent<{ actions?: InfoAction[] }>('PapoInfo', (props): RenderOutput => {
  const app = useApp();
  const info = useStoreValue<Info | null>(INFO, null) ?? { title: '', lines: [] };
  const shown = info.lines.length > MAX_LINES
    ? [...info.lines.slice(0, MAX_LINES), `… ${info.lines.length - MAX_LINES} more lines`]
    : info.lines;
  const close = () => app.layers.close(LAYER);
  return (
    <Dialog
      title={info.title}
      width={WIDTH}
      onClose={close}
      actions={[
        ...(props.actions ?? []).map((action) => ({ id: action.id, label: action.label, onPress: () => { close(); action.run(); } })),
        { id: 'close', label: 'Close', onPress: close },
      ]}
    >
      <Column>
        {shown.map((line, index) => <text key={String(index)} content={line === '' ? ' ' : line} truncate="end" />)}
      </Column>
    </Dialog>
  );
});

/** Opens the overlay on `info`; a second call replaces what the first showed. */
export function showInfo(app: TextUIApp, info: Info, actions?: InfoAction[]): void {
  app.store.set(INFO, info);
  app.layers.close(LAYER);
  app.layers.open({
    id: LAYER,
    layer: 'modal',
    scrim: true,
    trapFocus: true,
    dismissOnEscape: true,
    node: { component: 'PapoInfo', ...(actions !== undefined ? { actions } : {}) },
  });
}
