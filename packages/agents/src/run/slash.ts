import type { Agent } from '../types/agent.js';
import type { ContentPart } from '../types/message.js';
import type { SlashCommand, SlashCommandInfo } from '../types/slash-command.js';

/** What a runtime or prompt command name must match. */
export const SLASH_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const SLASH_LINE = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/;

/** What `/compact` writes as its notice once the summary is in. */
export const COMPACTED = 'Compacted';

/** The built-in `/compact`: the run's one step writes the summary (`writeSummary`), so `run` is never called. */
export const COMPACT_COMMAND: SlashCommand = Object.freeze({
  name: 'compact',
  description: 'Summarize the conversation so far, so later turns start from the summary',
  run: async () => undefined,
});

/** The harness's own runtime commands, after the program's and the capabilities'. */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [COMPACT_COMMAND];

/** A slash line: a string, or one text part, that is `/<name>` with optional arguments. Text with an image is never one. */
export function parseSlash(input: string | ContentPart[]): { name: string; args: string } | undefined {
  let text: string;
  if (typeof input === 'string') text = input;
  else if (input.length === 1 && input[0]!.type === 'text') text = input[0]!.text;
  else return undefined;
  const match = SLASH_LINE.exec(text);
  return match ? { name: match[1]!, args: match[2] ?? '' } : undefined;
}

/** The agent's runtime commands, as a client lists them. */
export function listSlashCommands(agent: Pick<Agent<any>, 'slashCommands'>): SlashCommandInfo[] {
  return agent.slashCommands.map((command) => ({
    name: command.name,
    description: command.description,
    ...(command.argumentHint !== undefined ? { argumentHint: command.argumentHint } : {}),
    kind: 'runtime',
  }));
}
