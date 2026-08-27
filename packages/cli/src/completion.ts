import {
  fullyNamed,
  isFlag,
  literalPrefix,
  optionsOf,
  parsePattern,
  underPrefix,
  visible,
  type Command,
  type CompletionSource,
  type OptionSpec,
} from "@softcli/core";
import { matchCommand } from "./parse.js";

/**
 * Tab completion, from the same declaration as everything else.
 *
 * Dynamic, not a generated static script. A shell script that lists the option
 * names an author typed is worth very little; what somebody actually wants
 * completed is the ids on *this* server and the profiles in *this* config, and
 * only the running program knows those. So the shell asks the program - the
 * hidden `__complete` command below - exactly as `gh` and every cobra binary do.
 */

async function candidatesFrom(
  source: CompletionSource | undefined,
  context: { words: readonly string[]; current: string; command: Command | null },
): Promise<readonly string[]> {
  if (source === undefined) return [];
  if (Array.isArray(source)) return source;
  return await (source as Exclude<CompletionSource, readonly string[]>)(context);
}

function optionNames(options: readonly OptionSpec[]): string[] {
  return visible(options).map((option) => option.name);
}

/**
 * What could come next.
 *
 * `words` is everything already typed after the program name; `current` is the
 * partial word under the cursor. Failures are swallowed: a completion that
 * throws would print a stack trace into somebody's prompt.
 */
export async function completeWords(
  commands: readonly Command[],
  globals: readonly OptionSpec[],
  words: readonly string[],
  current: string,
): Promise<string[]> {
  try {
    return await candidates(commands, globals, words, current);
  } catch {
    return [];
  }
}

async function candidates(
  commands: readonly Command[],
  globals: readonly OptionSpec[],
  words: readonly string[],
  current: string,
): Promise<string[]> {
  const plain = words.filter((word) => !word.startsWith("-"));
  const matched = matchCommand(commands, plain)?.command
    ?? commands.find((command) => fullyNamed(command, plain))
    ?? null;

  // Completing the value of the option just typed.
  const previous = words[words.length - 1];
  if (previous !== undefined && previous.startsWith("-") && !current.startsWith("-")) {
    const option = [...globals, ...(matched === null ? [] : optionsOf(matched))]
      .find((one) => one.name === previous || one.short === previous);
    if (option !== undefined && !isFlag(option)) {
      const values = await candidatesFrom(option.complete, { words, current, command: matched });
      const fixed = option.coerce?.candidates ?? [];
      return [...new Set([...values, ...fixed])].filter((value) => value.startsWith(current));
    }
  }

  if (current.startsWith("-")) {
    const names = optionNames([...globals, ...(matched === null ? [] : optionsOf(matched))]);
    return names.filter((name) => name.startsWith(current));
  }

  // The next literal word of any command whose prefix these words are.
  const nextWords = new Set<string>();
  for (const command of visible(commands)) {
    if (!underPrefix(command, plain)) continue;
    const next = literalPrefix(command)[plain.length];
    if (next !== undefined) nextWords.add(next);
  }

  // The next slot of the command already matched, when it has one to fill.
  if (matched !== null) {
    const tokens = parsePattern(matched.pattern);
    const filled = plain.length;
    const token = tokens[filled];
    if (token !== undefined && token.kind === "slot") {
      const spec = matched.arguments?.[token.name];
      const values = await candidatesFrom(spec?.complete, { words, current, command: matched });
      for (const value of [...values, ...(spec?.coerce?.candidates ?? [])]) nextWords.add(value);
    }
  }

  return [...nextWords].filter((word) => word.startsWith(current)).sort();
}

/**
 * The shell side, which is deliberately tiny.
 *
 * Every shell here does the same thing: hand the words to the program and print
 * what comes back. Keeping the logic on this side of the boundary means fixing
 * completion never means telling anyone to re-source anything.
 */
export function completionScript(shell: string, name: string): string {
  if (shell === "bash") {
    return [
      `_${name}_complete() {`,
      `  local IFS=$'\\n'`,
      `  COMPREPLY=( $(${name} __complete -- "\${COMP_WORDS[@]:1:COMP_CWORD-1}" "\${COMP_WORDS[COMP_CWORD]}") )`,
      `}`,
      `complete -o default -F _${name}_complete ${name}`,
      ``,
    ].join("\n");
  }
  if (shell === "zsh") {
    return [
      `#compdef ${name}`,
      `_${name}() {`,
      `  local -a completions`,
      `  completions=(\${(f)"$(${name} __complete -- \${words[2,CURRENT-1]} \${words[CURRENT]})"})`,
      `  compadd -- $completions`,
      `}`,
      `compdef _${name} ${name}`,
      ``,
    ].join("\n");
  }
  if (shell === "fish") {
    return [
      `function __${name}_complete`,
      `  set -l tokens (commandline -opc) (commandline -ct)`,
      `  ${name} __complete -- $tokens[2..-1]`,
      `end`,
      `complete -c ${name} -f -a '(__${name}_complete)'`,
      ``,
    ].join("\n");
  }
  throw new Error(`No completion script for ${shell}`);
}

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
