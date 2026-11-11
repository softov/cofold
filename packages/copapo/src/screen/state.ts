import type { BindingPath } from '@textui/core';

/**
 * Where the conversation lives on screen.
 *
 * The store is the only state. What the service says is folded in here and every part of the
 * screen reads it back out; nothing in this file renders.
 */
export const SESSIONS = '$/copapo/sessions' as BindingPath;
/** The row the cursor is on in the catalogue. */
export const SELECTED = '$/copapo/selected' as BindingPath;
/** The open conversation's session id; null on a conversation that has not been started. */
export const OPEN = '$/copapo/open' as BindingPath;
/** The open conversation, as last read. */
export const SNAPSHOT = '$/copapo/snapshot' as BindingPath;
export const DRAFT = '$/copapo/draft' as BindingPath;
export const EXPANDED = '$/copapo/expanded' as BindingPath;
/** What was last refused, in the service's words; cleared by the next success. */
export const ERROR = '$/copapo/error' as BindingPath;
/** The chat's latest warning, shown above the key hints until the person changes screen or sends a message. */
export const WARNING = '$/copapo/warning' as BindingPath;
/** What became of the answer given to the waiting block. */
export const INPUT_STATUS = '$/copapo/inputStatus' as BindingPath;
/** Draft answers to the waiting question, keyed under the request id. */
export const ANSWERS = '$/copapo/answers' as BindingPath;
export const MARKDOWN = '$/copapo/markdown' as BindingPath;
/** What the open conversation runs with; for a conversation not yet started, what it will start with. */
export const SETTINGS = '$/copapo/settings' as BindingPath;
/** The providers a model may be chosen from, as `chat.providers()` answered at start. */
export const PROVIDERS = '$/copapo/providers' as BindingPath;
/** Where copapo runs: `{ workspace, home }`, set once at boot; the session head's Place rows (CLI-06.2). */
export const PLACE = '$/copapo/place' as BindingPath;
/** The models listed so far, per provider: `chat.models({ provider })` is asked when a provider is chosen, once. */
export const MODELS = '$/copapo/models' as BindingPath;
/** The runtime's commands, then the prompt commands, as `chat.commands()` answered at start. */
export const COMMANDS = '$/copapo/commands' as BindingPath;
/** What the information overlay shows (`/help`, `/memory`, `/export`). */
export const INFO = '$/copapo/info' as BindingPath;

/** textui's own: which screen is current, and which node holds the keyboard. */
export const SCREEN = '$/layout/screen/current' as BindingPath;
export const FOCUS = '$/focus/id' as BindingPath;

export const SESSIONS_SCOPE = 'copapo.sessions';
export const CHAT_SCOPE = 'copapo.chat';
