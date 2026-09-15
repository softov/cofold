import type { Capability, CapabilityArgs } from '../types/capability.js';
import type { SkillIndexEntry, SkillSource } from '../types/skills.js';
import { AgentError } from '../errors.js';
import { createTool } from '../tool/create-tool.js';

const RULES = [
  'A skill is a set of instructions stored in a SKILL.md file. The list below has the skills available in this session (name and description).',
  'When the user names a skill or the task clearly matches a skill description, read it with read_skill({ name }) before doing the work and follow it for that turn.',
  'Read only what the SKILL.md points to (read_skill({ name, path }) for files beside it). Do not load everything.',
  'If a skill cannot be applied (missing files, unclear steps), say so and continue with the next-best approach.',
].join('\n');

/**
 * The first core capability (decision 85): an index of the available skills in the instructions and one
 * `read_skill` tool. Sources are content providers; `@facio/store-file` ships `fileSkillSource`.
 */
export function skills(options: { sources: SkillSource[]; warn?: (message: string) => void }): Capability {
  if (options.sources.length === 0) throw new AgentError({ code: 'invalid_options', message: 'skills(): at least one source' });
  let warned = false;
  const index = async (args: CapabilityArgs) => {
    const seen = new Map<string, { entry: SkillIndexEntry; source: SkillSource }>();
    for (const source of options.sources) {
      for (const entry of await source.list({ ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) })) {
        if (seen.has(entry.name)) {
          if (!warned) { warned = true; options.warn?.(`skills: duplicate skill "${entry.name}"; first source wins`); }
          continue;
        }
        seen.set(entry.name, { entry, source });
      }
    }
    return seen;
  };
  return {
    id: 'skills',
    async instructions(args) {
      const entries = [...(await index(args)).values()].map(({ entry }) => `- ${entry.name}: ${entry.description}`);
      return entries.length ? `${RULES}\n\n${entries.join('\n')}` : undefined;
    },
    async tools(args) {
      const map = await index(args);
      return [createTool<{ name: string; path?: string }>({
        name: 'read_skill',
        description: 'Read a skill (its SKILL.md) or a file beside it by relative path.',
        input: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } }, required: ['name'], additionalProperties: false },
        effects: { reads: true },
        execute: async (input) => {
          const hit = map.get(input.name);
          if (!hit) throw new Error(`unknown skill "${input.name}"`);
          return hit.source.read({ ref: hit.entry.ref, ...(input.path !== undefined ? { path: input.path } : {}) });
        },
      })];
    },
  };
}
