/**
 * @cofold/terminal - the terminal rendering of a registry.
 *
 * Argv in, one of three output shapes out, and nothing about what the commands
 * mean. Everything here is true of every command in every program: the standard
 * global options, help derived from the declaration, completion asked of the
 * running program rather than baked into a shell script, and an exit code
 * taxonomy a script can switch on.
 */
export { completeWords, completionScript, COMPLETION_SHELLS } from "./completion.js";
export { GLOBAL_NAMES, globalOptions } from "./globals.js";
export { help, helpForCommand, helpForProgram } from "./help.js";
export { emit, renderPlain } from "./output.js";
export { parse } from "./parse.js";
export { renderDefinitions, renderDocument, renderJson, renderTable, styleFor } from "./render.js";
export { Program, processIo } from "./program.js";
export { failureOf, redact, writeFailure } from "./failure.js";
export { runEntry } from "./entry.js";
export { keysOf } from "./keys.js";
export { colorSupported, glyphsFor, paintFor, unicodeSupported } from "./glyphs.js";
export { createPrompts, NO_TERMINAL, PromptCancelled } from "./prompts/index.js";

export type { EntryOptions } from "./types/entry.js";
export type { Failure } from "./types/failure.js";
export type { Glyphs, Paint } from "./types/glyphs.js";
export type { HelpOptions } from "./types/help.js";
export type { Invocation } from "./types/invocation.js";
export type { TerminalKey } from "./types/keys.js";
export type { OutputMode, Style } from "./types/output.js";
export type { ProgramOptions } from "./types/program.js";
export type {
  PromptChoice, PromptConfirmOptions, PromptGroup, PromptInput, PromptMarks, PromptMultiselectOptions,
  PromptOutput, Prompts, PromptSelectOptions, PromptsOptions, PromptTextOptions, PromptTone,
} from "./types/prompts.js";
