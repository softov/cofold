import type { ChatAnswer, ChatSendStatus } from '@textui/chat';
import { ChatComposer, ChatHitl, ChatInputStatus, ChatTranscript } from '@textui/chat';
import type { BindingPath, RenderOutput } from '@textui/core';
import { defineComponent, useApp, useFocusScope, useMemo, useRequiredService, useStore, useStoreValue } from '@textui/core';
import { Column, Divider } from '@textui/widgets';
import { toBlocks } from '../blocks.js';
import type { Snapshot } from '../types/turn.js';
import { CONTROLLER, PAPO } from './app.js';
import { ANSWERS, CHAT_SCOPE, DRAFT, EXPANDED, INPUT_STATUS, MARKDOWN, SNAPSHOT } from './state.js';

const NONE_EXPANDED: Record<string, boolean> = {};

/**
 * The conversation: the transcript, the block waiting on a person when there is one, the composer.
 *
 * Everything drawn is a snapshot the controller wrote; the screen holds only what is its own, which
 * is the cursor, what is folded open and the draft.
 */
export const ChatScreen: (props: Record<string, never>) => RenderOutput =
  defineComponent<Record<string, never>>('ChatScreen', () => {
    const app = useApp();
    const controller = useRequiredService(CONTROLLER);
    const papo = useRequiredService(PAPO);
    useFocusScope({ id: CHAT_SCOPE });

    const snapshot = useStoreValue<Snapshot | null>(SNAPSHOT, null) ?? null;
    const draft = useStoreValue<string>(DRAFT, '') ?? '';
    const expanded = useStoreValue<Record<string, boolean>>(EXPANDED, NONE_EXPANDED) ?? NONE_EXPANDED;
    const markdown = useStoreValue<boolean>(MARKDOWN, true) ?? true;
    const inputStatus = useStoreValue<ChatSendStatus | null>(INPUT_STATUS, null) ?? null;
    const [cursor, setCursor] = useStore<number>('$/screen.chat/cursor' as BindingPath, 0);
    const pending = snapshot?.pending ?? null;
    const [answers, setAnswers] = useStore<Record<string, ChatAnswer>>(`${ANSWERS}/${pending?.id ?? 'none'}` as BindingPath, {});

    const model = papo.chat.model() || undefined;
    const blocks = useMemo(() => toBlocks(snapshot?.turns ?? [], model), [snapshot, model]);
    // Only before anything is said: once there is a conversation, the header names it.
    const head = useMemo(() => (snapshot === null ? (
      <Column padding={[0, 0, 1, 0]}>
        <text content="A new conversation. Say something below." fg="muted" truncate="end" />
        <Divider dim />
      </Column>
    ) : undefined), [snapshot === null]);

    const onToggle = useMemo(() => (id: string) => {
      app.store.set(EXPANDED, { ...expanded, [id]: !expanded[id] });
    }, [expanded, app]);
    const onCursor = useMemo(() => (next: number) => setCursor(next), []);

    return (
      <Column flex={1} gap={1}>
        <ChatTranscript
          {...(head !== undefined ? { head } : {})}
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
          placeholder={pending !== null ? 'Answer the block above first' : 'Say something'}
          onChange={(value: string) => app.store.set(DRAFT, value)}
          onSubmit={(value: string) => void controller.send(value)}
          onCancel={() => app.focus.focus('chat.transcript')}
          onLeave={() => app.focus.focus('chat.transcript')}
          autoFocus={pending === null}
        />
      </Column>
    );
  });
