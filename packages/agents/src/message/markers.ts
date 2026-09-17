/**
 * What a cancelled run writes to the transcript (cli/03 F4), in Claude's runtime's wording so one projection reads
 * both: the marker is a `role: 'user'`, `source: 'system'` message; the tool text answers every call the cancel cut.
 */
export const INTERRUPTED = '[Request interrupted by user]';
export const INTERRUPTED_TOOL = '[Request interrupted by user for tool use]';
