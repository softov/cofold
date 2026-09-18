import type { ChatAnswer, ChatCommand, ChatSendStatus, ComposerOption } from '@textui/chat';
import { ChatComposer, ChatHitl, ChatInputStatus, ChatSessionHead, ChatTranscript, openPicker, settingIcon, valueIcon } from '@textui/chat';
import type { BindingPath, RenderOutput } from '@textui/core';
import { defineComponent, useApp, useCapabilities, useFocusScope, useMemo, useRequiredService, useStore, useStoreValue } from '@textui/core';
import type { SkillIndexEntry } from '@facio/agents';
import { Column, Divider, argumentOf } from '@textui/widgets';
import { QUEUED_BLOCK, toBlocks } from '../blocks.js';
import type { Settings } from '../types/settings.js';
import type { Snapshot } from '../types/turn.js';
import { CONTROLLER, PERMISSION_LABELS, REASONING_LABELS } from './app.js';
import { ANSWERS, CHAT_SCOPE, DRAFT, EXPANDED, INPUT_STATUS, MARKDOWN, PLACE, SETTINGS, SKILLS, SNAPSHOT } from './state.js';
import { sessionView } from './sessions.js';

/**
 * What a slash offers: the skills first (a `session` command is sent as `/<name> ...`, which is how
 * the agent is told to read one), then the palette's own commands (a `client` command runs here).
 */
function useSlashCommands(): ChatCommand[] {
  const app = useApp();
  const skills = useStoreValue<SkillIndexEntry[]>(SKILLS, []) ?? [];
  return useMemo(() => [
    ...skills.map((skill): ChatCommand => ({ id: skill.name, kind: 'session', title: skill.name, description: skill.description })),
    ...app.commands.list({ slot: 'palette', enabledOnly: true }).map((command): ChatCommand => ({
      id: command.id, kind: 'client', title: command.title, ...(command.description !== undefined ? { description: command.description } : {}),
    })),
  ], [skills, app]);
}

/**
 * The row under the field: which model, what it may do without asking, how hard it thinks; while a
 * turn runs, the way to queue the draft instead of steering with it (decision CLI-04.1).
 *
 * Each chip is a value and opens the command that asks about it. The mark in front is what keeps a
 * chip identifiable when the row truncates on a narrow terminal.
 */
function useComposerOptions(running: boolean): ComposerOption[] {
  const unicode = useCapabilities().unicode;
  const settings = useStoreValue<Settings | null>(SETTINGS, null) ?? null;
  return useMemo(() => {
    if (settings === null) return [];
    return [
      ...(running ? [{ id: 'queue', icon: settingIcon(unicode, 'queue'), label: 'Queue', title: 'Hold the draft as the next turn (enter steers)', commandId: 'chat.queue' }] : []),
      { id: 'model', icon: settingIcon(unicode, 'model'), label: settings.model || 'first listed model', title: 'Model', commandId: 'compose.model' },
      {
        id: 'permissions',
        icon: valueIcon(unicode, settings.permissions, PERMISSION_LABELS[settings.permissions].label) ?? settingIcon(unicode, 'permissions'),
        label: PERMISSION_LABELS[settings.permissions].label,
        title: 'Permissions',
        commandId: 'compose.permissions',
      },
      { id: 'reasoning', icon: settingIcon(unicode, 'thinking'), label: REASONING_LABELS[settings.reasoning], title: 'Thinking', commandId: 'compose.reasoning' },
    ];
  }, [settings?.model, settings?.permissions, settings?.reasoning, unicode, running]);
}

const NONE_EXPANDED: Record<string, boolean> = {};

/**
 * The conversation: the transcript, the block waiting on a person when there is one, the composer.
 *
 * Everything drawn is a snapshot the controller wrote; the screen holds only what is its own, which
 * is the cursor, what is folded open and the draft.
 */
/** The session's tokens so far as the head says them; nothing while no turn has reported any. */
function tokensOf(turns: Snapshot['turns']): string {
  const sum = turns.reduce((total, turn) => ({ input: total.input + turn.usage.inputTokens, output: total.output + turn.usage.outputTokens }), { input: 0, output: 0 });
  return sum.input === 0 && sum.output === 0 ? '' : `${String(sum.input)} in, ${String(sum.output)} out`;
}

export const ChatScreen: (props: Record<string, never>) => RenderOutput =
  defineComponent<Record<string, never>>('ChatScreen', () => {
    const app = useApp();
    const controller = useRequiredService(CONTROLLER);
    useFocusScope({ id: CHAT_SCOPE });

    const snapshot = useStoreValue<Snapshot | null>(SNAPSHOT, null) ?? null;
    const draft = useStoreValue<string>(DRAFT, '') ?? '';
    const expanded = useStoreValue<Record<string, boolean>>(EXPANDED, NONE_EXPANDED) ?? NONE_EXPANDED;
    const markdown = useStoreValue<boolean>(MARKDOWN, true) ?? true;
    const inputStatus = useStoreValue<ChatSendStatus | null>(INPUT_STATUS, null) ?? null;
    const [cursor, setCursor] = useStore<number>('$/screen.chat/cursor' as BindingPath, 0);
    const pending = snapshot?.pending ?? null;
    const [answers, setAnswers] = useStore<Record<string, ChatAnswer>>(`${ANSWERS}/${pending?.id ?? 'none'}` as BindingPath, {});

    const model = snapshot?.settings.model;
    const blocks = useMemo(() => toBlocks(snapshot?.turns ?? [], model, snapshot?.queued ?? []), [snapshot, model]);
    const options = useComposerOptions(snapshot?.running ?? false);
    const commands = useSlashCommands();
    const place = useStoreValue<{ workspace: string; home: string } | null>(PLACE, null) ?? null;
    /*
     * What this conversation is, at the top of it (CLI-06.2): the session's title and state, the model
     * and the settings in force, where it runs, when, its id, and what it used so far. Scrolled with the
     * transcript, as the component is designed; `/status` has the same facts once it is out of view.
     * Rebuilt only when what it says changes: the parts are new objects every render, the caption is not.
     */
    const headRows = snapshot === null ? [] : [
      { label: 'Permissions', value: PERMISSION_LABELS[snapshot.settings.permissions].label },
      { label: 'Thinking', value: REASONING_LABELS[snapshot.settings.reasoning] },
      { label: 'Auto-compact', value: snapshot.settings.autoCompact ? 'on' : 'off' },
      { label: 'Turns', value: `${String(snapshot.turns.length)}${snapshot.running ? ', one running' : ''}${snapshot.queued.length > 0 ? `, ${String(snapshot.queued.length)} queued` : ''}` },
      { label: 'Tokens', value: tokensOf(snapshot.turns) },
      // Last, so it sits next to the Workspace row the component draws after the settings.
      ...(place !== null ? [{ label: 'Home', value: place.home }] : []),
    ];
    const headSignature = JSON.stringify([snapshot?.session, model, headRows]);
    const head = useMemo(() => (
      <Column padding={[0, 0, 1, 0]}>
        {snapshot === null
          ? <text content="A new conversation. Say something below." fg="muted" truncate="end" />
          : <ChatSessionHead session={sessionView(snapshot.session)} {...(model ? { model } : {})} settings={headRows} />}
        <Divider dim />
      </Column>
    ), [headSignature]);

    const onToggle = useMemo(() => (id: string) => {
      // `enter` on a queued row drops it; on anything else it folds the row open or shut.
      if (id.startsWith(QUEUED_BLOCK)) { void controller.unqueue(id.slice(QUEUED_BLOCK.length)); return; }
      app.store.set(EXPANDED, { ...expanded, [id]: !expanded[id] });
    }, [expanded, app, controller]);
    const onCursor = useMemo(() => (next: number) => setCursor(next), []);

    return (
      <Column flex={1} gap={1}>
        <ChatTranscript
          head={head}
          flex={1}
          blocks={blocks}
          expanded={expanded}
          cursor={cursor ?? 0}
          onCursor={onCursor}
          onToggle={onToggle}
          markdown={markdown}
        />

        {pending !== null ? (
          <ChatHitl
            input={pending}
            draft={answers ?? {}}
            onDraft={setAnswers}
            onApprove={(option?: string) => void controller.approve(option)}
            onDeny={() => void controller.deny()}
            onAnswer={(given, accepted) => void controller.answer(given, accepted)}
            onEscape={() => {
              if (app.focus.focused() === 'chat.transcript') app.screens.pop();
              else app.focus.focus('chat.transcript');
            }}
          />
        ) : null}

        <ChatInputStatus status={inputStatus} />

        <ChatComposer
          value={draft}
          running={snapshot?.running ?? false}
          queued={snapshot?.queued.length ?? 0}
          options={options}
          onOption={(option, anchorId) => {
            if (option.commandId === undefined) return;
            // The settings chips open the picker of their one argument; a chip that asks nothing (Queue) is run by the picker itself.
            openPicker(app, { commandId: option.commandId, anchorId, descriptions: 'below' });
          }}
          placeholder={pending !== null ? 'Answer the block above first' : 'Say something, or / for a skill or a command'}
          commands={commands}
          onCommand={(picked: ChatCommand) => {
            // A skill is typed, not run: the draft becomes `/<name> ` and the person finishes the line.
            if (picked.kind === 'session') { app.store.set(DRAFT, `/${picked.id} `); app.focus.focus('chat.composer'); return; }
            app.store.set(DRAFT, '');
            const command = app.commands.get(picked.id);
            if (command && argumentOf(command)) { openPicker(app, { commandId: picked.id, anchorId: 'chat.composer', descriptions: 'below' }); return; }
            void app.execute(picked.id, undefined, 'palette');
          }}
          onChange={(value: string) => app.store.set(DRAFT, value)}
          onSubmit={(value: string) => void controller.send(value)}
          onCancel={() => app.focus.focus('chat.transcript')}
          onLeave={() => app.focus.focus('chat.transcript')}
          autoFocus={pending === null}
        />
      </Column>
    );
  });
