import type { ChatSession } from '@textui/chat';
import { SessionList } from '@textui/chat';
import type { RenderOutput } from '@textui/core';
import { defineComponent, useApp, useEffect, useFocusScope, useRequiredService, useStoreValue } from '@textui/core';
import { Panel } from '@textui/widgets';
import type { SessionRow } from '../types/turn.js';
import { CONTROLLER } from './app.js';
import { SELECTED, SESSIONS, SESSIONS_SCOPE } from './state.js';

const NONE: SessionRow[] = [];

/** A row of the store, as the catalogue draws it: the word, the colour and the glyph travel together. */
export function sessionView(row: SessionRow): ChatSession {
  const status = ((): ChatSession['status'] => {
    switch (row.activity) {
      case 'awaiting': return { activity: 'input', archived: false, read: true, label: 'waiting on you', tone: 'warning', glyph: 'bulletHalf' };
      case 'running': return { activity: 'running', archived: false, read: true, label: 'running', tone: 'accent', glyph: 'bulletFilled' };
      case 'failed': return { activity: 'error', archived: false, read: true, label: 'failed', tone: 'danger', glyph: 'cross' };
      case 'idle': return { activity: 'idle', archived: false, read: true, label: 'idle', tone: 'muted', glyph: 'bulletHollow' };
    }
  })();
  return {
    id: row.id,
    title: row.title,
    provider: 'papo',
    status,
    createdAt: row.createdAt,
    modifiedAt: row.updatedAt,
    workingDirectories: row.workspace !== undefined ? [row.workspace] : [],
  };
}

export const SessionsScreen: (props: Record<string, never>) => RenderOutput =
  defineComponent<Record<string, never>>('SessionsScreen', () => {
    const app = useApp();
    const controller = useRequiredService(CONTROLLER);
    // While this is mounted, `n` `d` `r` mean what the catalogue means by them.
    useFocusScope({ id: SESSIONS_SCOPE });
    const sessions = useStoreValue<SessionRow[]>(SESSIONS, NONE) ?? NONE;
    const selected = useStoreValue<string | null>(SELECTED, null) ?? null;
    const waiting = sessions.filter((row) => row.activity === 'awaiting').length;

    // A list with a highlight and nothing selected is a key that does nothing.
    const ids = sessions.map((row) => row.id).join(',');
    useEffect(() => {
      if (sessions.length === 0) { app.store.set(SELECTED, null); return; }
      if (selected !== null && sessions.some((row) => row.id === selected)) return;
      app.store.set(SELECTED, sessions[0]?.id ?? null);
    }, [ids]);

    return (
      <Panel
        title="Sessions"
        flex={1}
        meta={waiting > 0 ? `${waiting} waiting on you` : `${sessions.length} in this workspace`}
      >
        <SessionList
          sessions={sessions.map(sessionView)}
          selectedId={selected}
          focusId="papo.sessions.list"
          autoFocus
          flex={1}
          onSelect={(id: string) => app.store.set(SELECTED, id)}
          onOpen={(id: string) => { void controller.open(id).then(() => app.screens.push('chat')); }}
          emptyMessage="No sessions here yet. Press n to start one."
        />
      </Panel>
    );
  });
