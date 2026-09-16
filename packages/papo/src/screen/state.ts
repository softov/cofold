import type { BindingPath } from '@textui/core';

/**
 * Where the conversation lives on screen.
 *
 * The store is the only state. What the service says is folded in here and every part of the
 * screen reads it back out; nothing in this file renders.
 */
export const SESSIONS = '$/papo/sessions' as BindingPath;
/** The row the cursor is on in the catalogue. */
export const SELECTED = '$/papo/selected' as BindingPath;
/** The open conversation's session id; null on a conversation that has not been started. */
export const OPEN = '$/papo/open' as BindingPath;
/** The open conversation, as last read. */
export const SNAPSHOT = '$/papo/snapshot' as BindingPath;
export const DRAFT = '$/papo/draft' as BindingPath;
export const EXPANDED = '$/papo/expanded' as BindingPath;
/** What was last refused, in the service's words; cleared by the next success. */
export const ERROR = '$/papo/error' as BindingPath;
/** What became of the answer given to the waiting block. */
export const INPUT_STATUS = '$/papo/inputStatus' as BindingPath;
/** Draft answers to the waiting question, keyed under the request id. */
export const ANSWERS = '$/papo/answers' as BindingPath;
export const MARKDOWN = '$/papo/markdown' as BindingPath;
/** What the open conversation runs with; for a conversation not yet started, what it will start with. */
export const SETTINGS = '$/papo/settings' as BindingPath;
/** The catalogue of models, as `chat.models()` last answered. */
export const MODELS = '$/papo/models' as BindingPath;
/** The skills a slash may name, as `chat.skills()` last answered. */
export const SKILLS = '$/papo/skills' as BindingPath;

/** textui's own: which screen is current, and which node holds the keyboard. */
export const SCREEN = '$/layout/screen/current' as BindingPath;
export const FOCUS = '$/focus/id' as BindingPath;

export const SESSIONS_SCOPE = 'papo.sessions';
export const CHAT_SCOPE = 'papo.chat';
