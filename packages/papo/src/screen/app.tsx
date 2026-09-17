import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AskAnswers, SkillIndexEntry } from '@facio/agents';
import { workspaceSlug } from '@facio/store-file';
import type { ChatAnswer, ChatSendStatus } from '@textui/chat';
import {
  ChatBubble, ChatComposer, ChatHitl, ChatInputStatus, ChatTranscript, ReasoningBlock, SessionList, StreamingText, ToolCallRow,
} from '@textui/chat';
import type { ArgChoices, ArgSpec, BoxProps, Disposable, ServiceKey, TextUIApp } from '@textui/core';
import { createBag, defineComponent, serviceKey, useApp, useStoreValue, useTheme } from '@textui/core';
import { KeyHints, Row, registerBuiltins } from '@textui/widgets';
import type { Papo } from '../commands.js';
import { AUTO_COMPACT_AT } from '../agent.js';
import { redactedConfig, rememberedOf } from '../commands.js';
import { splitModel } from '../config.js';
import { exportPath, toMarkdown } from '../export.js';
import { toAskAnswers } from '../questions.js';
import type { ModelRow, ProviderRow } from '../types/chat.js';
import type { Settings } from '../types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from '../types/settings.js';
import type { Snapshot, Turn } from '../types/turn.js';
import { ChatScreen } from './chat.js';
import { PapoInfo, showInfo } from './info.js';
import { SessionsScreen } from './sessions.js';
import {
  ANSWERS, CHAT_SCOPE, DRAFT, ERROR, FOCUS, INPUT_STATUS, MARKDOWN, MODELS, OPEN, PROVIDERS, SCREEN, SELECTED, SESSIONS, SESSIONS_SCOPE, SETTINGS, SKILLS,
  SNAPSHOT,
} from './state.js';

/** The words on the chips and in the picker, for the values the configuration spells: Claude Code's four modes (cli/03 F8). */
export const PERMISSION_LABELS: Record<Settings['permissions'], { label: string; description: string }> = {
  default: { label: 'Ask before changes', description: 'Reads run; a tool that writes, destroys or reaches the network waits for you.' },
  acceptEdits: { label: 'Accept edits', description: 'File edits inside the workspace run; commands, the network and edits outside still wait.' },
  bypassPermissions: { label: 'Bypass permissions', description: 'Every tool call runs; only a deny or ask rule stops one.' },
  dontAsk: { label: "Don't ask", description: 'What would wait for you is refused instead; reads run.' },
};
export const REASONING_LABELS: Record<Settings['reasoning'], string> = { off: 'No thinking', low: 'Think a little', medium: 'Think', high: 'Think hard' };

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
  /** Say the text: a new turn, or a steer into the one running (decision 95). */
  send(text: string): Promise<void>;
  /** Hold the text as the open conversation's next turn (decision CLI-04.1). */
  queue(text: string): Promise<void>;
  unqueue(id: string): Promise<void>;
  approve(optionId?: string): Promise<void>;
  deny(): Promise<void>;
  answer(answers: Record<string, ChatAnswer>, accepted: boolean): Promise<void>;
  stop(): Promise<void>;
  remove(sessionId: string): Promise<void>;
  /** Change what the open conversation runs with; before it exists, what it will start with. */
  configure(patch: Partial<Settings>): Promise<void>;
  /** Fold the open conversation into a summary; a run of its own, watched like a turn. */
  compact(): Promise<void>;
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
      if (open() === sessionId) {
        app.store.set(SNAPSHOT, snapshot);
        app.store.set(SETTINGS, snapshot.settings);
      }
    } catch (error: unknown) {
      report(error);
    }
  }

  /** What a conversation not yet started will run with: the defaults, then whatever was chosen on the chips. */
  const draftSettings = (): Settings | null => app.store.get<Settings>(SETTINGS) ?? null;

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
      if (sessionId !== null) { await reload(sessionId); return; }
      try { app.store.set(SETTINGS, await chat.settings()); } catch (error: unknown) { report(error); }
    },

    async send(text) {
      const trimmed = text.trim();
      if (trimmed === '') return;
      try {
        const current = open();
        const chosen = current === null ? draftSettings() : null;
        const started = await chat.say({
          text: trimmed,
          ...(current !== null ? { sessionId: current } : {}),
          ...(chosen !== null ? { settings: chosen } : {}),
        });
        app.store.set(DRAFT, '');
        app.store.set(ERROR, null);
        if (current === null) app.store.set(OPEN, started.sessionId);
        await reload(started.sessionId);
      } catch (error: unknown) {
        report(error);
      }
    },

    async queue(text) {
      const trimmed = text.trim();
      const current = open();
      if (trimmed === '' || current === null) return;
      try {
        await chat.queue({ sessionId: current, text: trimmed });
        app.store.set(DRAFT, '');
        app.store.set(ERROR, null);
        await reload(current);
      } catch (error: unknown) {
        report(error);
      }
    },

    async unqueue(id) {
      const current = open();
      if (current === null) return;
      try {
        await chat.unqueue(current, id);
        app.store.set(ERROR, null);
        await reload(current);
      } catch (error: unknown) {
        report(error);
      }
    },

    approve: (optionId) => decide('approved', (id) => chat.approve(id, { always: optionId === 'always' })),
    deny: () => decide('denied', (id) => chat.deny(id)),
    answer: (answers, accepted) => decide(accepted ? 'answered' : 'declined', (id) =>
      accepted ? chat.answer(id, toAskAnswers(answers) satisfies AskAnswers) : chat.deny(id, { reason: 'The user declined to answer' })),

    async stop() {
      const current = open();
      if (current === null) return;
      try { await chat.cancel(current); } catch (error: unknown) { report(error); }
    },

    async compact() {
      const current = open();
      if (current === null) { report(new Error('compact: nothing said yet')); return; }
      try {
        await chat.compact(current);
        app.store.set(ERROR, null);
        await reload(current);
      } catch (error: unknown) {
        report(error);
      }
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

    async configure(patch) {
      const current = open();
      try {
        if (current === null) {
          const held = draftSettings() ?? await chat.settings();
          app.store.set(SETTINGS, { ...held, ...patch });
        } else {
          app.store.set(SETTINGS, await chat.configure(current, patch));
        }
        app.store.set(ERROR, null);
      } catch (error: unknown) {
        report(error);
        return;
      }
      // The pick is the next new conversation's default too (decision CLI-05.1); a file that cannot be written is said
      // on the status row and the pick still holds on the session.
      const remembered = rememberedOf(patch);
      if (Object.keys(remembered).length === 0) return;
      try {
        await papo.remember(remembered);
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
  const settings = useStoreValue<Settings | null>(SETTINGS, null) ?? null;
  const model = settings?.model || papo.config.model || 'first listed model';
  // The title belongs to the conversation on screen; the catalogue has no one thing to name.
  const title = screen !== 'chat' ? undefined : snapshot?.session.title ?? (open === null ? 'new conversation' : undefined);
  return (
    <Row gap={1}>
      <text content="papo" bold fg="accent" shrink={0} />
      <text content={theme.glyphs.separator} fg="subtle" shrink={0} />
      {title !== undefined
        ? <text content={title} flex={1} truncate="end" />
        : <text content={''} fg="muted" flex={1} truncate="end" />}
      {/* <text content={model} fg="muted" shrink={2} truncate="end" /> */}
      <text content={papo.workspace} fg="muted" shrink={2} truncate="start" />
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
          ...(composing
            ? [{ keys: 'enter', label: 'send' }, { keys: 'tab', label: 'settings' }]
            : [{ keys: upDown, label: 'scroll' }]),
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
    ['PapoInfo', PapoInfo],
  ] as const) {
    bag.add(app.components.register({ component, category: 'template', renderer: { kind: 'function', render: render as never } }));
  }

  bag.add(app.surfaces.open({ surface: 'header', key: 'title', target: { component: 'PapoHeader' } }));
  bag.add(app.surfaces.open({ surface: 'status', key: 'status', target: { component: 'PapoStatus' } }));
  bag.add(app.screens.register({ id: 'sessions', component: 'SessionsScreen' }));
  // Kept alive: coming back to a conversation that scrolled itself to the top is losing your place.
  bag.add(app.screens.register({ id: 'chat', component: 'ChatScreen', keepAlive: true }));

  const { papo } = options;
  const selected = (): string | null => app.store.get<string | null>(SELECTED) ?? null;
  const settings = (): Settings | null => app.store.get<Settings>(SETTINGS) ?? null;
  const providers = (): ProviderRow[] => app.store.get<ProviderRow[]>(PROVIDERS) ?? [];
  /**
   * One provider's models, asked of it the first time it is chosen and kept (cli/05 task 05). Asking
   * every provider at start made one that is down (a local server that is off) stall the chip for
   * its whole timeout and, before `models()` learnt to skip it, hide the others' models altogether.
   * A listing that fails says so on the status row and offers nothing, which is the truth of it.
   */
  const modelsOf = async (provider: string): Promise<ModelRow[]> => {
    const listed = app.store.get<Record<string, ModelRow[]>>(MODELS) ?? {};
    const held = listed[provider];
    if (held !== undefined) return held;
    try {
      const rows = await papo.chat.models({ provider });
      app.store.set(MODELS, { ...listed, [provider]: rows });
      return rows;
    } catch (error: unknown) {
      app.store.set(ERROR, `models: ${provider}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
  const commands = [
    /*
     * The chips' questions, as commands with one argument each: the picker asks it, the palette
     * lists it, and a key could be bound to it. The composer row knows only the command ids.
     */
    {
      id: 'compose.model', title: 'Model', category: 'Compose', slots: ['palette'],
      /*
       * Two questions, provider then model (CLI-05.2): the second list is that provider's rows only,
       * through textui's `choices(collected)`. The providers come from the service (`chat.providers()`:
       * the configuration's list, or `claude` on that backend), so a provider that is down is still
       * offered and says why when chosen; its models are asked for then, not at start.
       */
      args: [
        {
          name: 'provider', type: 'string' as const, required: true, description: 'Which provider',
          get default(): string | undefined {
            const model = settings()?.model;
            return model ? splitModel(model).provider : providers().find((row) => row.default)?.id ?? providers()[0]?.id;
          },
          // Asked only when there is a choice to make: with one provider the default stands and the
          // palette skips the question (`argumentOf` asks nothing of an argument without `choices`).
          // A getter, because the list arrives after the command is registered; the cast is what lets
          // it read as absent under `exactOptionalPropertyTypes`, which is how every reader treats it.
          get choices(): (() => ArgChoices) | undefined {
            const listed = providers();
            return listed.length > 1
              ? () => listed.map((row) => ({ value: row.id, label: row.id, ...(row.baseUrl !== undefined ? { description: row.baseUrl } : {}) }))
              : undefined;
          },
        } as ArgSpec,
        {
          name: 'model', type: 'string' as const, required: true, description: 'Which model answers',
          get default(): string | undefined { const model = settings()?.model; return model ? splitModel(model).modelId : undefined; },
          descriptions: 'below' as const,
          choices: async (collected: Readonly<Record<string, unknown>>) => (await modelsOf(String(collected['provider'])))
            .map((row) => ({
              value: row.id,
              label: row.id,
              description: [row.name !== row.id ? row.name : '', row.contextTokens !== undefined ? `${Math.round(row.contextTokens / 1000)}k context` : '', row.features.reasoning ? 'reasoning' : '']
                .filter(Boolean).join(' · '),
            })),
        },
      ],
      run: (args: Record<string, unknown>) => { void controller.configure({ model: `${String(args['provider'])}/${String(args['model'])}` }); },
    },
    {
      id: 'compose.permissions', title: 'Permissions', category: 'Compose', slots: ['palette'],
      args: [{
        name: 'value', type: 'string' as const, required: true, description: 'When a tool call stops to ask',
        get default(): string | undefined { return settings()?.permissions; },
        descriptions: 'below' as const,
        choices: () => PERMISSION_MODES.map((mode) => ({ value: mode, ...PERMISSION_LABELS[mode] })),
      }],
      run: (args: Record<string, unknown>) => { void controller.configure({ permissions: String(args['value']) as Settings['permissions'] }); },
    },
    {
      id: 'compose.reasoning', title: 'Thinking', category: 'Compose', slots: ['palette'],
      args: [{
        name: 'value', type: 'string' as const, required: true, description: 'How much the model thinks first',
        get default(): string | undefined { return settings()?.reasoning; },
        choices: () => REASONING_LEVELS.map((level) => ({ value: level, label: REASONING_LABELS[level] })),
      }],
      run: (args: Record<string, unknown>) => { void controller.configure({ reasoning: String(args['value']) as Settings['reasoning'] }); },
    },
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
      id: 'chat.queue', title: 'Queue the message', category: 'Chat', slots: ['palette'], description: 'Hold what is in the field as the next turn; it starts when this one ends',
      when: `${SCREEN} == 'chat' && ${SNAPSHOT}/running`,
      run: () => { void controller.queue(app.store.get<string>(DRAFT) ?? ''); },
    },
    {
      id: 'chat.unqueue', title: 'Drop a queued message', category: 'Chat', slots: ['palette'],
      when: `${SCREEN} == 'chat' && ${SNAPSHOT}/queued/0`,
      args: [{
        name: 'id', type: 'string' as const, required: true, description: 'Which queued message',
        descriptions: 'below' as const,
        choices: () => (snapshot()?.queued ?? []).map((waiting) => ({ value: waiting.id, label: waiting.text.replace(/\s+/g, ' ').slice(0, 60), description: waiting.id })),
      }],
      run: (args: Record<string, unknown>) => { void controller.unqueue(String(args['id'])); },
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
    {
      id: 'chat.compact', title: 'Compact', category: 'Chat', slots: ['palette'], description: 'Fold the conversation so far into a summary the model continues from',
      run: () => void controller.compact(),
    },
    {
      id: 'chat.autocompact', title: 'Auto-compact', category: 'Chat', slots: ['palette'], keepOpen: true,
      description: 'Fold the conversation before a turn once it nears the context budget',
      get badge(): string { return settings()?.autoCompact === false ? 'off' : 'on'; },
      run: () => { void controller.configure({ autoCompact: !(settings()?.autoCompact ?? true) }); },
    },
    {
      id: 'chat.status', title: 'Status', category: 'Chat', slots: ['palette'], description: 'Session, model, mode, folders, tokens',
      run: () => showInfo(app, { title: 'Status', lines: statusLines() }),
    },
    {
      id: 'chat.cost', title: 'Cost', category: 'Chat', slots: ['palette'], description: 'Tokens per turn and in total',
      run: () => showInfo(app, { title: 'Cost', lines: costLines() }),
    },
    {
      id: 'chat.skill', title: 'Skill', category: 'Chat', slots: ['palette'], description: 'Put /<skill> in the field',
      args: [{
        name: 'name', type: 'string' as const, required: true, description: 'Which skill',
        descriptions: 'below' as const,
        choices: () => (app.store.get<SkillIndexEntry[]>(SKILLS) ?? []).map((skill) => ({ value: skill.name, label: `/${skill.name}`, description: skill.description })),
      }],
      run: (args: Record<string, unknown>) => {
        app.store.set(DRAFT, `/${String(args['name'])} `);
        if (app.store.get<string>(SCREEN) !== 'chat') void controller.open(null).then(() => app.screens.push('chat'));
        app.focus.focus('chat.composer');
      },
    },
    {
      id: 'chat.memory', title: 'Memory', category: 'Chat', slots: ['palette'], description: 'What the agent remembers about this workspace',
      run: async () => {
        const path = memoryIndexPath();
        const text = await readFile(path, 'utf8').catch(() => undefined);
        showInfo(app, { title: `Memory  ${path}`, lines: text === undefined || text.trim() === '' ? ['Nothing remembered yet.'] : text.trimEnd().split('\n') },
          [{ id: 'edit', label: `Edit in ${editorName()}`, run: () => void editFile(path) }]);
      },
    },
    {
      id: 'chat.export', title: 'Export', category: 'Chat', slots: ['palette'], description: 'Write the conversation as Markdown',
      run: async () => {
        const current = open();
        if (current === null) { app.store.set(ERROR, 'export: nothing said yet'); return; }
        try {
          const path = exportPath(papo.workspace, current);
          await writeFile(path, toMarkdown(await papo.chat.snapshot(current)), 'utf8');
          showInfo(app, { title: 'Exported', lines: ['Written to', path] });
        } catch (error: unknown) {
          app.store.set(ERROR, `export: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      id: 'chat.retry', title: 'Retry', category: 'Chat', slots: ['palette'], description: 'Send the last message again',
      run: () => {
        const last = snapshot()?.turns.at(-1);
        if (last === undefined) { app.store.set(ERROR, 'retry: nothing said yet'); return; }
        if (snapshot()?.running) { app.store.set(ERROR, 'retry: a turn is running'); return; }
        void controller.send(last.input);
      },
    },
    {
      id: 'session.clear', title: 'Clear: start a new conversation', category: 'Sessions', slots: ['palette'], description: 'The current one stays in the catalogue',
      run: () => { void controller.open(null).then(() => app.screens.push('chat')); },
    },
    {
      id: 'view.theme', title: 'Theme', category: 'View', slots: ['palette'], description: 'The colors and shapes',
      args: [{
        name: 'id', type: 'string' as const, required: true, description: 'Which theme',
        choices: () => app.themes.list().map((theme) => theme.id),
        get default(): string { return app.theme.id; },
        // Worn while the highlight moves: a theme's name says nothing until the screen is in it.
        preview: (value: string | null) => { app.setTheme(value ?? papo.config.theme); },
      }],
      run: (args: Record<string, unknown>) => { app.setTheme(String(args['id'])); },
    },
    {
      id: 'app.config', title: 'Configuration', category: 'Navigation', slots: ['palette'], description: 'What is in force, keys redacted',
      run: () => showInfo(app, { title: 'Configuration', lines: JSON.stringify(redactedConfig(papo), null, 2).split('\n') }),
    },
    {
      id: 'app.help', title: 'Help', category: 'Navigation', slots: ['palette'], description: 'Every command and key',
      run: () => showInfo(app, { title: 'Help', lines: helpLines() }),
    },
  ];

  const snapshot = (): Snapshot | null => app.store.get<Snapshot | null>(SNAPSHOT) ?? null;
  const open = (): string | null => app.store.get<string | null>(OPEN) ?? null;
  const memoryIndexPath = () => join(papo.home, 'memory', workspaceSlug({ workspace: papo.workspace }), 'MEMORY.md');
  const total = (turns: Turn[]) => turns.reduce((sum, turn) => ({ input: sum.input + turn.usage.inputTokens, output: sum.output + turn.usage.outputTokens }), { input: 0, output: 0 });

  function statusLines(): string[] {
    const current = snapshot();
    const chosen = settings();
    const sum = total(current?.turns ?? []);
    return [
      `session      ${current?.session.id ?? '(not started)'}${current !== null ? `  ${current.session.title}` : ''}`,
      `model        ${chosen?.model || 'first listed model'}`,
      `permissions  ${chosen === null ? '' : PERMISSION_LABELS[chosen.permissions].label}`,
      `thinking     ${chosen === null ? '' : REASONING_LABELS[chosen.reasoning]}`,
      `auto-compact ${chosen === null ? '' : chosen.autoCompact ? `on, at ${Math.floor(papo.config.context.maxTokens * AUTO_COMPACT_AT)} of ${papo.config.context.maxTokens} tokens` : 'off'}`,
      `workspace    ${papo.workspace}`,
      `home         ${papo.home}`,
      `turns        ${current?.turns.length ?? 0}${current?.running ? '  (one running)' : ''}${current !== null && current.queued.length > 0 ? `  (${current.queued.length} queued)` : ''}`,
      `tokens       ${sum.input} in, ${sum.output} out`,
    ];
  }

  function costLines(): string[] {
    const turns = snapshot()?.turns ?? [];
    if (turns.length === 0) return ['Nothing said yet.'];
    const sum = total(turns);
    const rows = turns.map((turn, index) => `${String(index + 1).padStart(3)}  ${String(turn.usage.inputTokens).padStart(7)} in  ${String(turn.usage.outputTokens).padStart(7)} out  ${String(turn.steps).padStart(2)} steps  ${turn.input.replace(/\s+/g, ' ').slice(0, 30)}`);
    return [...rows, '', `total  ${sum.input} in, ${sum.output} out, ${turns.length} turns`, 'Counts are what the provider reported; a provider that reports nothing shows zeros.'];
  }

  function helpLines(): string[] {
    const bound = new Map<string, string[]>();
    for (const binding of app.keybindings.list()) {
      if (binding.args !== undefined) continue;
      bound.set(binding.commandId, [...(bound.get(binding.commandId) ?? []), String(binding.keys)]);
    }
    const rows = app.commands.list({ slot: 'palette', enabledOnly: false }).map((command) =>
      `  /${command.id.split('.').at(-1)}  ${command.title.padEnd(36)} ${(bound.get(command.id) ?? []).join(', ')}`);
    return [
      'Type / in the field for a skill or one of these; ctrl+p opens the same list.',
      '',
      ...rows,
      '',
      'On the conversation: tab reaches the chips under the field, a and d answer a confirmation, esc goes back.',
      'On the catalogue: enter opens, n starts, d deletes, r refreshes.',
    ];
  }

  function editorName(): string {
    return process.env['VISUAL'] || process.env['EDITOR'] || (process.platform === 'win32' ? 'notepad' : 'vi');
  }

  /** The editor over the screen: the terminal is handed to it and taken back (`app.suspend`). */
  async function editFile(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const [command, ...args] = editorName().split(/\s+/) as [string, ...string[]];
    try {
      await app.suspend(() => new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args, path], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', () => resolve());
      }));
    } catch (error: unknown) {
      app.store.set(ERROR, `${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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

  // The skills, once: what the slash menu offers beside the palette's commands.
  void options.papo.chat.skills()
    .then((rows) => app.store.set(SKILLS, rows))
    .catch((error: unknown) => app.store.set(ERROR, `skills: ${error instanceof Error ? error.message : String(error)}`));
  // The providers, once; nothing is asked of them until a provider is chosen on the chip (`modelsOf`).
  void options.papo.chat.providers()
    .then((rows) => app.store.set(PROVIDERS, rows))
    .catch((error: unknown) => app.store.set(ERROR, `providers: ${error instanceof Error ? error.message : String(error)}`));
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

