/**
 * softcli/cli - the terminal rendering of a registry.
 *
 * Argv in, one of three output shapes out, and nothing about what the commands
 * mean. Everything here is true of every command in every program: the standard
 * global options, help derived from the declaration, completion asked of the
 * running program rather than baked into a shell script, and an exit code
 * taxonomy a script can switch on.
 */
export { completeWords, completionScript, COMPLETION_SHELLS } from "./completion.js";
export { GLOBAL_NAMES, globalOptions } from "./globals.js";
export type { OutputMode } from "./globals.js";
export { help, helpForCommand, helpForProgram } from "./help.js";
export type { HelpOptions } from "./help.js";
export { emit, renderPlain } from "./output.js";
export { matchCommand, optionTable, parse, tokenize } from "./parse.js";
export type { Invocation, Match, Tokens } from "./parse.js";
export { renderDefinitions, renderDocument, renderJson, renderTable, styleFor } from "./render.js";
export type { Style } from "./render.js";
export { Program, processIo } from "./program.js";
export type { ProgramOptions } from "./program.js";
export { redact, runEntry } from "./entry.js";
export type { EntryOptions } from "./entry.js";
export { didYouMean, suggest } from "./suggest.js";
