import type { ModelRow } from '../types/chat.js';
import type { SessionConfigOption, SessionModeState, SessionSetup } from '../types/acp.js';
import type { Settings } from '../types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from '../types/settings.js';
import type { PermissionMode } from '../types/config.js';

/** How a client names copapo's permission modes, and what each does. */
const MODES: Readonly<Record<PermissionMode, { name: string; description: string }>> = {
  default: { name: 'Default', description: 'Ask before a tool that writes, deletes or reaches the network' },
  acceptEdits: { name: 'Accept edits', description: 'As Default, and edit files in the workspace without asking' },
  bypassPermissions: { name: 'Bypass permissions', description: 'Run every tool without asking; a deny or ask rule still holds' },
  dontAsk: { name: "Don't ask", description: 'Refuse what Default would ask about' },
};

export const MODEL_OPTION = 'model';
export const THOUGHT_OPTION = 'thought_level';

export function modesOf(settings: Settings): SessionModeState {
  return {
    currentModeId: settings.permissions,
    availableModes: PERMISSION_MODES.map((id) => ({ id, ...MODES[id] })),
  };
}

/**
 * The model and the thinking level as config options of category `model` and `thought_level`, the two a
 * client draws as pickers. No model option when no model is listed: a picker with nothing in it says nothing.
 */
export function configOptionsOf(settings: Settings, models: readonly ModelRow[]): SessionConfigOption[] {
  const options: SessionConfigOption[] = [];
  if (models.length > 0) {
    const current = settings.model !== '' ? settings.model : models[0]!.ref;
    const listed = models.map((model) => ({ value: model.ref, name: model.name || model.ref }));
    // A session on a model no provider lists any more still shows what it is on.
    if (!listed.some((one) => one.value === current)) listed.unshift({ value: current, name: current });
    options.push({ type: 'select', id: MODEL_OPTION, name: 'Model', category: 'model', currentValue: current, options: listed });
  }
  options.push({
    type: 'select', id: THOUGHT_OPTION, name: 'Thinking', category: 'thought_level', currentValue: settings.reasoning,
    options: REASONING_LEVELS.map((level) => ({ value: level, name: level === 'off' ? 'Off' : `${level[0]!.toUpperCase()}${level.slice(1)}` })),
  });
  return options;
}

export function setupOf(settings: Settings, models: readonly ModelRow[]): SessionSetup {
  return { modes: modesOf(settings), configOptions: configOptionsOf(settings, models) };
}

/** A `session/set_config_option` as a settings patch; undefined for an option copapo does not offer. */
export function patchOf(configId: string, value: unknown): Partial<Settings> | undefined {
  if (typeof value !== 'string') return undefined;
  if (configId === MODEL_OPTION) return { model: value };
  if (configId === THOUGHT_OPTION) return { reasoning: value as Settings['reasoning'] };
  return undefined;
}
