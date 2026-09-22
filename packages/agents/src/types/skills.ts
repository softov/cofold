/** One entry of the skill index the model sees. */
export interface SkillIndexEntry {
  /** Frontmatter `name`, else the folder name. Must match /^[a-zA-Z0-9_-]{1,64}$/ so the model can name it. */
  name: string;
  /** Frontmatter `description`; the trigger text. */
  description: string;
  /** Opaque locator the source understands (folder path, row id, AHP uri). Shown to the model only as a label. */
  ref: string;
}

/**
 * Where skills come from (parent decision 31). Not part of Store: skills are content, the store is runtime state.
 * `@doopx/store-file` ships `fileSkillSource`; a DB or an AHP host implements the same two methods.
 */
export interface SkillSource {
  /** Skills visible to this session: global ones plus the workspace's own when `workspace` is set. */
  list(args: { workspace?: string }): Promise<SkillIndexEntry[]>;
  /** The SKILL.md body for `ref`; with `path` (relative, e.g. 'references/x.md') a file beside it. Throws AgentError('not_found'). */
  read(args: { ref: string; path?: string }): Promise<string>;
}
