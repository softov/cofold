import type { OutputMode } from "./types/output.js";
import type { ProgramOptions } from "./types/program.js";
import { stdin as processStdin, stdout, stderr } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  ArgumentError,
  canonicalFromCli,
  commandPattern,
  compact,
  didYouMean,
  literalPrefix,
  optionsOf,
  output,
  parsePattern,
  surfaceEnabled,
  visible,
  type Command,
  type Io,
  type OptionSpec,
  type Output,
  type Runner,
} from "@cofold/commands";
import { completeWords, completionScript, COMPLETION_SHELLS } from "./completion.js";
import { GLOBAL_NAMES, globalOptions } from "./globals.js";
import { help } from "./help.js";
import { emit } from "./output.js";
import { parse } from "./parse.js";
import { styleFor } from "./render.js";

/**
 * The command line in front of a registry.
 *
 * Everything true of *every* command lives here exactly once: `--version`,
 * `--help`, the output contract, completion, and turning argv into the
 * canonical input. A handler is entered only when all of that is settled, which
 * is why handlers in a program built on this are three lines long.
 *
 * What is deliberately absent: any knowledge of what the commands are. The
 * registry is passed in, so a program can register its surface in as many files
 * as it has domains, and a test can build a registry of two commands and drive
 * the same code path the binary does.
 */

export const processIo: Io = {
  out: (text) => { stdout.write(text); },
  err: (text) => { stderr.write(text); },
};

/** A question on stderr, answered on stdin: `y` or `yes` runs it, anything else does not. */
async function askTerminal(question: string): Promise<boolean> {
  const reader = createInterface({ input: processStdin, output: stderr });
  try {
    return ["y", "yes"].includes((await reader.question(question)).trim().toLowerCase());
  } finally {
    reader.close();
  }
}

/** What a `remove` is said to do: `pet remove removes pet 7`. */
function removal(command: Command, input: Readonly<Record<string, unknown>>): string {
  const said = [`${literalPrefix(command).join(" ")} removes`];
  const resource = command.resource;
  if (resource === undefined) return `${said[0]} something`;
  said.push(resource.kind);
  const value = resource.key === undefined ? undefined : input[resource.key];
  if (value !== undefined) said.push(Array.isArray(value) ? value.map(String).join(", ") : String(value));
  return said.join(" ");
}

async function readAllStdin(): Promise<string> {
  if (processStdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of processStdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export class Program {
  readonly #options: ProgramOptions;
  readonly #io: Io;
  readonly #globals: readonly OptionSpec[];
  readonly #builtins: Command[] = [];

  public constructor(options: ProgramOptions) {
    this.#options = options;
    this.#io = options.io ?? processIo;
    const extra = options.globals ?? [];
    for (const option of extra) {
      if (GLOBAL_NAMES.includes(option.name)) {
        throw new Error(`${option.name} is a standard global option and cannot be redeclared`);
      }
    }
    this.#globals = [...globalOptions, ...extra];
    if (options.builtins !== false) this.#builtins.push(...this.#builtinCommands());
  }

  public get name(): string {
    return this.#options.name;
  }

  /** Registered commands and the built-in ones, as the parser sees them. */
  public get commands(): readonly Command[] {
    return [
      ...this.#options.registry.commands.filter((command) => surfaceEnabled(command, "cli")),
      ...this.#builtins,
    ];
  }

  public get globals(): readonly OptionSpec[] {
    return this.#globals;
  }

  public async run(argv: readonly string[]): Promise<number> {
    this.#options.registry.verify();

    const invocation = parse(this.commands, this.#globals, argv);
    const flag = (name: string): boolean => invocation.options[name] === true;

    if (flag("--version")) {
      this.#io.out(`${this.#options.version}\n`);
      return 0;
    }
    if (flag("--json") && flag("--quiet")) {
      this.#io.err(`${this.name}: --json and --quiet cannot be combined\n`);
      return 2;
    }

    const style = flag("--no-color") ? styleFor({ color: false }) : styleFor();
    const helpOptions = {
      name: this.name,
      version: this.#options.version,
      commands: this.commands,
      globals: this.#globals,
      groups: this.#options.registry.groups,
      style,
      ...compact({ description: this.#options.description }),
    };

    if (flag("--help")) {
      // Always by literal prefix, with the parsed command only as a fallback.
      this.#io.out(help({
        ...helpOptions,
        prefix: invocation.words,
        matched: invocation.command ?? undefined,
      }));
      // After the static help is on screen, so a slow lookup delays nothing
      // that was going to be printed anyway.
      if (this.#options.liveHelp !== undefined) {
        this.#io.out(await this.#options.liveHelp(invocation.command, invocation.words));
      }
      return 0;
    }

    if (invocation.command === null) {
      if (invocation.words.length === 0) {
        this.#io.out(help(helpOptions));
        return 0;
      }
      // Compared whole, not word by word: somebody who typed `note lst` wants
      // to be told about `note list`, and being told about `note` is being told
      // what they already knew.
      const typed = invocation.words.join(" ");
      const wanting = visible(this.commands).find((command) => literalPrefix(command).join(" ") === typed);
      const missing = wanting === undefined ? undefined
        : parsePattern(wanting.pattern).find((token) => token.kind === "slot" && !token.optional);
      if (wanting !== undefined && missing?.kind === "slot") {
        this.#io.err(`${this.name}: "${typed}" needs ${missing.name}.\nUsage: ${this.name} ${commandPattern(wanting)}\n`);
        return 2;
      }
      const known = [...new Set(visible(this.commands)
        .map((command) => literalPrefix(command).join(" ")))];
      this.#io.err(`${this.name}: unknown command "${typed}".${didYouMean(typed, known)} Try ${this.name} --help\n`);
      return 2;
    }

    const command = invocation.command;
    const mode: OutputMode = flag("--json") ? "json" : flag("--quiet") ? "quiet" : "plain";
    const readStdin = this.#options.readStdin ?? readAllStdin;

    const globals = await canonicalFromCli(
      { id: "__globals", pattern: ["__globals"], summary: "", options: this.#globals, run: () => {} },
      { slots: {}, options: invocation.options },
    );

    const own = new Set(optionsOf(command).map((option) => option.name));
    const input = await canonicalFromCli(command, {
      slots: invocation.slots,
      options: Object.fromEntries(
        Object.entries(invocation.options).filter(([name]) => own.has(name))),
      ...compact({ stdin: command.stdin === undefined ? undefined : await readStdin() }),
    });

    if (command.effect === "remove" && !flag("--yes")) {
      const what = removal(command, input);
      const confirm = this.#confirm();
      if (confirm === undefined) {
        this.#io.err(`${this.name}: ${what}; pass --yes to run it without a terminal\n`);
        return 2;
      }
      if (!await confirm(`${what}. Continue? [y/N] `)) {
        this.#io.err(`${this.name}: not run\n`);
        return 1;
      }
    }

    const result = await this.#options.registry.execute(command, {
      surface: "cli",
      input,
      globals,
      io: this.#io,
      readStdin,
    });

    emit(this.#io, result, mode);
    return 0;
  }

  /** Who answers before a `remove`, or nothing when there is no terminal to ask. */
  #confirm(): ((question: string) => Promise<boolean>) | undefined {
    const given = this.#options.confirm;
    if (given === false) return undefined;
    if (given !== undefined) return given;
    return processStdin.isTTY === true && stderr.isTTY === true ? askTerminal : undefined;
  }

  #builtinCommands(): Command[] {
    const shells = COMPLETION_SHELLS.join(", ");
    return [
      {
        id: "__complete",
        pattern: ["__complete", ":words..."],
        summary: "Candidates for the words typed so far",
        hidden: true,
        surfaces: { mcp: false, docs: false },
        run: async (context): Promise<Output> => {
          const words = context.list("words");
          const current = words[words.length - 1] ?? "";
          const before = words.slice(0, -1);
          const found = await completeWords(this.commands, this.#globals, before, current);
          return output(found, `${found.join("\n")}${found.length === 0 ? "" : "\n"}`);
        },
      },
      {
        id: "completion",
        pattern: ["completion", ":shell"],
        summary: `Print the shell completion script (${shells})`,
        arguments: { shell: { description: shells } },
        surfaces: { mcp: false },
        examples: [{
          command: `${this.name} completion bash > /etc/bash_completion.d/${this.name}`,
          description: "Install it once; the candidates stay live",
        }],
        run: (context): Output => {
          const shell = context.value("shell");
          if (!COMPLETION_SHELLS.includes(shell as (typeof COMPLETION_SHELLS)[number])) {
            throw new ArgumentError(`shell must be one of ${shells}`);
          }
          const script = completionScript(shell, this.name);
          return output(script, script);
        },
      },
    ];
  }
}
