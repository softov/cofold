import type { AskAnswers } from '@facio/agents';
import type { ChatAnswer, ChatSendStatus } from '@textui/chat';
import {
  ChatBubble, ChatComposer, ChatHitl, ChatInputStatus, ChatTranscript, ReasoningBlock, SessionList, StreamingText, ToolCallRow,
} from '@textui/chat';
import type { BoxProps, Disposable, ServiceKey, TextUIApp } from '@textui/core';
import { createBag, defineComponent, serviceKey, useApp, useStoreValue, useTheme } from '@textui/core';
import { KeyHints, Row, registerBuiltins } from '@textui/widgets';
import type { Papo } from '../commands.js';
import { toAskAnswers } from '../questions.js';
import type { Snapshot } from '../types/turn.js';
import { ChatScreen } from './chat.js';
import { SessionsScreen } from './sessions.js';
import {
  ANSWERS, CHAT_SCOPE, DRAFT, ERROR, FOCUS, INPUT_STATUS, MARKDOWN, OPEN, SCREEN, SELECTED, SESSIONS, SESSIONS_SCOPE, SNAPSHOT,
} from './state.js';

/**
 * What the screen can do, as the keys and the palette reach it.
 *
 * Thin on purpose: the service holds the harness, the store holds the state, and this is the
 * translation between a key and a call. Every method reports a refusal to the store rather than
 * throwing, because a key that throws is an application that exits.
 */
export interface Controller extends Disposable {
  refresh(): Promise<void>;
  /** Open a session, or `null` for a conversation that starts with the first message. */
  open(sessionId: string | null): Promise<void>;
  send(text: string): Promise<void>;
  approve(optionId?: string): Promise<void>;
  deny(): Promise<void>;
  answer(answers: Record<string, ChatAnswer>, accepted: boolean): Promise<void>;
  stop(): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

export const CONTROLLER: ServiceKey<Controller> = serviceKey<Controller>('papo.controller');

export function createController(app: TextUIApp, papo: Papo): Controller {
  const { chat } = papo;
  const bag = createBag();
  const report = (error: unknown): void => {
    app.store.set(ERROR, error instanceof Error ? error.message : String(error));
  };
  const open = (): string | null => app.store.get<string | null>(OPEN) ?? null;

  async function reload(sessionId: string): Promise<void> {
    try {
      const snapshot = await chat.snapshot(sessionId);
      if (open() === sessionId) app.store.set(SNAPSHOT, snapshot);
    } catch (error: unknown) {
      report(error);
    }
  }

  const controller: Controller = {
    async refresh() {
      try {
        app.store.set(SESSIONS, await chat.sessions());
        app.store.set(ERROR, null);
      } catch (error: unknown) {
        report(error);
      }
    },

    async open(sessionId) {
      app.store.set(OPEN, sessionId);
      app.store.set(SNAPSHOT, null);
      app.store.set(DRAFT, '');
      app.store.set(INPUT_STATUS, null);
      if (sessionId !== null) await reload(sessionId);
    },

    async send(text) {
      const trimmed = text.trim();
      if (trimmed === '') return;
      try {
        const current = open();
        const started = await chat.say({ text: trimmed, ...(current !== null ? { sessionId: current } : {}) });
        app.store.set(DRAFT, '');
        app.store.set(ERROR, null);
        if (current === null) app.store.set(OPEN, started.sessionId);
        await reload(started.sessionId);
      } catch (error: unknown) {
        report(error);
      }
    },

    approve: (optionId) => decide('approved', (id) => chat.approve(id, { always: optionId === 'always' })),
    deny: () => decide('denied', (id) => chat.deny(id)),
    answer: (answers, accepted) => decide(accepted ? 'answered' : 'declined', (id) =>
      accepted ? chat.answer(id, toAskAnswers(answers) satisfies AskAnswers) : chat.cancel(id)),

    async stop() {
      const current = open();
      if (current === null) return;
      try { await chat.cancel(current); } catch (error: unknown) { report(error); }
    },

    async remove(sessionId) {
      try {
        await chat.remove(sessionId);
        if (open() === sessionId) await controller.open(null);
        await controller.refresh();
      } catch (error: unknown) {
        report(error);
      }
    },

    dispose: () => bag.dispose(),
  };

  /** A decision on the waiting block: say it went, or say why it did not, on the row under it. */
  async function decide(word: string, act: (sessionId: string) => Promise<void>): Promise<void> {
    const current = open();
    if (current === null) return;
    const status = (state: ChatSendStatus['state'], text: string): void => { app.store.set(INPUT_STATUS, { state, text }); };
    status('sending', `${word}, sending`);
    try {
      await act(current);
      app.store.set(INPUT_STATUS, null);
      app.store.set(ANSWERS, {});
    } catch (error: unknown) {
      status('failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Coalesced: a turn wakes the listener once per event, and the catalogue needs only the last.
  let pending: NodeJS.Timeout | undefined;
  const unsubscribe = chat.subscribe((sessionId) => {
    if (sessionId === open()) void reload(sessionId);
    clearTimeout(pending);
    pending = setTimeout(() => { void controller.refresh(); }, 150);
    pending.unref?.();
  });
  bag.add({ dispose: () => { unsubscribe(); clearTimeout(pending); } });
  return controller;
}

const Header = defineComponent<Record<string, never>>('PapoHeader', () => {
  const app = useApp();
  const theme = useTheme();
  const snapshot = useStoreValue<Snapshot | null>(SNAPSHOT, null) ?? null;
  const open = useStoreValue<string | null>(OPEN, null) ?? null;
  const screen = useStoreValue<string | null>(SCREEN, null);
  const papo = app.services.require(PAPO);
  const model = papo.chat.model() || papo.config.model || 'first listed model';
  // The title belongs to the conversation on screen; the catalogue has no one thing to name.
  const title = screen !== 'chat' ? undefined : snapshot?.session.title ?? (open === null ? 'new conversation' : undefined);
  return (
    <Row gap={1}>
      <text content="papo" bold fg="accent" shrink={0} />
      <text content={theme.glyphs.separator} fg="subtle" shrink={0} />
      {title !== undefined
        ? <text content={title} flex={1} truncate="end" />
        : <text content={papo.workspace} fg="muted" flex={1} truncate="end" />}
      <text content={model} fg="muted" shrink={2} truncate="end" />
    </Row>
  );
});

const Hints = defineComponent<BoxProps>('PapoHints', (props) => {
  const theme = useTheme();
  const screen = useStoreValue<string | null>(SCREEN, 'sessions') ?? 'sessions';
  const snapshot = useStoreValue<Snapshot | null>(SNAPSHOT, null) ?? null;
  const focused = useStoreValue<string | null>(FOCUS, null);
  const upDown = `${theme.glyphs.arrowUp}${theme.glyphs.arrowDown}`;
  if (screen === 'chat') {
    const composing = focused === 'chat.composer';
    return (
      <KeyHints
        {...props}
        hints={[
          ...(snapshot?.pending !== null && snapshot?.pending !== undefined
            ? snapshot.pending.kind === 'toolConfirmation'
              ? [{ keys: 'a', label: 'approve' }, { keys: 'd', label: 'deny' }]
              : [{ keys: 'tab', label: 'answer' }]
            : []),
          ...(snapshot?.running ? [{ keys: 'ctrl+c', label: 'stop' }] : [{ keys: 'ctrl+c', label: 'quit' }]),
          composing
            ? { keys: 'enter', label: 'send' }
            : { keys: upDown, label: 'scroll' },
          { keys: 'esc', label: composing ? 'transcript' : 'sessions' },
          { keys: 'ctrl+n', label: 'new' },
          { keys: 'ctrl+p', label: 'commands' },
        ]}
      />
    );
  }
  return (
    <KeyHints
      {...props}
      hints={[
        { keys: upDown, label: 'move' },
        { keys: 'enter', label: 'open' },
        { keys: 'n', label: 'new' },
        { keys: 'd', label: 'delete' },
        { keys: 'r', label: 'refresh' },
        { keys: 'ctrl+p', label: 'commands' },
        { keys: 'ctrl+c', label: 'quit' },
      ]}
    />
  );
});

const Status = defineComponent<Record<string, never>>('PapoStatus', () => {
  const error = useStoreValue<string | null>(ERROR, null) ?? null;
  const said = useStoreValue<ChatSendStatus | null>(INPUT_STATUS, null) ?? null;
  const shown = said?.state === 'failed' && said.text === error ? null : error;
  return shown !== null
    ? <text content={shown} fg="danger" flex={1} truncate="end" />
    : <Hints flex={1} />;
});

export const PAPO: ServiceKey<Papo> = serviceKey<Papo>('papo');

export interface ScreenOptions {
  papo: Papo;
  /** Open on this session. */
  sessionId?: string;
  /** Quit, when the application's own key asks for it. */
  onQuit?(): void;
}

/** Mount the application: services, components, screens, surfaces, commands, keys. */
export function registerPapo(app: TextUIApp, options: ScreenOptions): Disposable {
  const bag = createBag();
  bag.add(registerBuiltins(app));
  const controller = createController(app, options.papo);
  bag.add(controller);
  bag.add(app.services.provide(PAPO, options.papo));
  bag.add(app.services.provide(CONTROLLER, controller));

  for (const [component, render] of [
    ['ChatBubble', ChatBubble],
    ['StreamingText', StreamingText],
    ['ReasoningBlock', ReasoningBlock],
    ['ToolCallRow', ToolCallRow],
    ['ChatTranscript', ChatTranscript],
    ['ChatComposer', ChatComposer],
    ['ChatHitl', ChatHitl],
    ['ChatInputStatus', ChatInputStatus],
    ['SessionList', SessionList],
    ['SessionsScreen', SessionsScreen],
    ['ChatScreen', ChatScreen],
    ['PapoHeader', Header],
    ['PapoStatus', Status],
    ['PapoHints', Hints],
  ] as const) {
    bag.add(app.components.register({ component, category: 'template', renderer: { kind: 'function', render: render as never } }));
  }

  bag.add(app.surfaces.open({ surface: 'header', key: 'title', target: { component: 'PapoHeader' } }));
  bag.add(app.surfaces.open({ surface: 'status', key: 'status', target: { component: 'PapoStatus' } }));
  bag.add(app.screens.register({ id: 'sessions', component: 'SessionsScreen' }));
  // Kept alive: coming back to a conversation that scrolled itself to the top is losing your place.
  bag.add(app.screens.register({ id: 'chat', component: 'ChatScreen', keepAlive: true }));

  const selected = (): string | null => app.store.get<string | null>(SELECTED) ?? null;
  const commands = [
    {
      id: 'app.palette', title: 'Command Palette', category: 'Navigation', slots: [] as string[],
      run: () => {
        app.layers.open({
          id: 'palette', layer: 'modal', scrim: true, trapFocus: true, dismissOnEscape: true,
          node: {
            component: 'CommandPalette', width: 62,
            commands: app.commands.list({ slot: 'palette', enabledOnly: true }),
            onClose: { handler: () => app.layers.close('palette') },
          },
        });
      },
    },
    { id: 'app.quit', title: 'Quit', category: 'Navigation', slots: ['palette'], run: () => options.onQuit?.() },
    {
      id: 'go.back', title: 'Back', category: 'Navigation', slots: ['palette'],
      run: () => { if (app.screens.current()?.id !== 'sessions') app.screens.pop(); },
    },
    {
      id: 'session.new', title: 'New conversation', category: 'Sessions', slots: ['palette'],
      run: () => { void controller.open(null).then(() => { if (app.screens.current()?.id !== 'chat') app.screens.push('chat'); }); },
    },
    {
      id: 'session.open', title: 'Open the selected session', category: 'Sessions', slots: [] as string[],
      when: `${SELECTED}`,
      run: () => { const id = selected(); if (id !== null) void controller.open(id).then(() => app.screens.push('chat')); },
    },
    {
      id: 'session.delete', title: 'Delete the selected session', category: 'Sessions', slots: ['palette'],
      when: `${SELECTED}`,
      run: () => { const id = selected(); if (id !== null) void controller.remove(id); },
    },
    { id: 'session.refresh', title: 'Refresh sessions', category: 'Sessions', slots: ['palette'], run: () => void controller.refresh() },
    {
      id: 'chat.stop', title: 'Stop the turn', category: 'Chat', slots: ['palette'],
      when: `${SCREEN} == 'chat' && ${SNAPSHOT}/running`,
      run: () => void controller.stop(),
    },
    {
      id: 'chat.approve', title: 'Approve the waiting tool call', category: 'Chat', slots: ['palette'],
      when: `${SCREEN} == 'chat' && ${SNAPSHOT}/pending`,
      run: () => void controller.approve(),
    },
    {
      id: 'chat.deny', title: 'Deny the waiting tool call', category: 'Chat', slots: ['palette'],
      when: `${SCREEN} == 'chat' && ${SNAPSHOT}/pending`,
      run: () => void controller.deny(),
    },
    {
      id: 'chat.markdown', title: 'Toggle markdown rendering', category: 'Chat', slots: ['palette'],
      run: () => { app.store.set(MARKDOWN, !(app.store.get<boolean>(MARKDOWN) ?? true)); },
    },
  ];
  for (const command of commands) bag.add(app.commands.register(command));

  const keys = [
    { keys: 'ctrl+p', commandId: 'app.palette' },
    { keys: 'ctrl+c', commandId: 'chat.stop', when: `${SCREEN} == 'chat' && ${SNAPSHOT}/running` },
    { keys: 'ctrl+c', commandId: 'app.quit' },
    { keys: 'ctrl+q', commandId: 'app.quit' },
    { keys: 'ctrl+n', commandId: 'session.new' },
    { keys: 'escape', commandId: 'go.back' },
    { keys: 'n', commandId: 'session.new', scopeId: SESSIONS_SCOPE },
    { keys: 'd', commandId: 'session.delete', scopeId: SESSIONS_SCOPE },
    { keys: 'r', commandId: 'session.refresh', scopeId: SESSIONS_SCOPE },
    { keys: 'alt+m', commandId: 'chat.markdown', scopeId: CHAT_SCOPE },
  ];
  for (const binding of keys) bag.add(app.keybindings.register(binding));

  void controller.refresh().then(async () => {
    if (options.sessionId !== undefined) {
      await controller.open(options.sessionId);
      app.screens.reset('sessions');
      app.screens.push('chat');
    } else {
      app.screens.reset('sessions');
    }
  });
  return bag;
}

