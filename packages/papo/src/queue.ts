import type { RunOutcome } from '@facio/agents';
import { AgentError, newId } from '@facio/agents';
import type { QueueDeps, Queued, Queues } from './types/chat.js';

/** The outcomes after which the head starts; `awaiting` waits on the person and `cancelled` was a cancel (CLI-04.1). */
const STARTS_HEAD: ReadonlySet<RunOutcome['status']> = new Set(['completed', 'stopped', 'failed']);

/**
 * The next turns of every session, in memory (decision CLI-04.1): one list per session, next to the
 * handle the service holds, gone with the process, as the reference's is. Both backends keep theirs
 * here; the service tells it when a turn settles and it starts the head through the service's `say`,
 * and a message queued while nothing runs starts the same way at once (the reference's `startNext`).
 * A `cancel` holds the session until a person says something again, so nothing starts after one.
 */
export function createQueues(deps: QueueDeps): Queues {
  const queues = new Map<string, Queued[]>();
  const held = new Set<string>();
  /** The head's `start` in flight per session, so `wait` can see a turn that is about to be attached. */
  const starting = new Map<string, Promise<void>>();
  const listOf = (sessionId: string): Queued[] => {
    let list = queues.get(sessionId);
    if (list === undefined) { list = []; queues.set(sessionId, list); }
    return list;
  };

  /**
   * Shifts the head and says it; a head that does not start stays at the head, warned once, for the next settle.
   * One start at a time per session: a head already on its way would otherwise be followed by a second run
   * that fails `writer_busy` against it.
   */
  async function startHead(sessionId: string): Promise<void> {
    if (starting.has(sessionId)) return;
    const list = queues.get(sessionId);
    const head = list?.shift();
    if (list === undefined || head === undefined) return;
    const task = (async () => {
      try {
        await deps.start(sessionId, head);
      } catch (error: unknown) {
        // Kept at the head: the person sees it still waiting, and the next settle tries again.
        list.unshift(head);
        deps.warn(`session ${sessionId}: the queued message did not start: ${error instanceof Error ? error.message : String(error)}`);
        deps.notify(sessionId);
      }
    })();
    starting.set(sessionId, task);
    try { await task; } finally { if (starting.get(sessionId) === task) starting.delete(sessionId); }
  }

  return {
    list: (sessionId) => [...(queues.get(sessionId) ?? [])],

    /** Appends, or replaces what waits under the same `id`; on an idle session the head starts at once. */
    async add(sessionId, args) {
      const entry: Queued = {
        id: args.id ?? newId(),
        text: args.text,
        ...(args.settings !== undefined ? { settings: args.settings } : {}),
        ...(args.steer === true ? { steer: true } : {}),
        at: new Date().toISOString(),
      };
      const list = listOf(sessionId);
      const at = list.findIndex((waiting) => waiting.id === entry.id);
      if (at >= 0) list[at] = entry;
      else list.push(entry);
      deps.notify(sessionId);
      if (!held.has(sessionId) && await deps.idle(sessionId)) await startHead(sessionId);
      return entry;
    },

    remove(sessionId, id) {
      const list = queues.get(sessionId) ?? [];
      const at = list.findIndex((waiting) => waiting.id === id);
      if (at < 0) throw new AgentError({ code: 'not_found', message: `session ${sessionId} has nothing queued as ${id}` });
      list.splice(at, 1);
      deps.notify(sessionId);
    },

    /** After a cancel: the head does not start on the coming settle, nor on a queue while idle. */
    hold(sessionId) { held.add(sessionId); },
    /** A person said something: the session takes its queue again. */
    release(sessionId) { held.delete(sessionId); },

    /** The run settled: start the head when the outcome and the person allow it. */
    async settled(sessionId, status) {
      if (!STARTS_HEAD.has(status) || held.has(sessionId)) return;
      await startHead(sessionId);
    },

    starting: (sessionId) => starting.get(sessionId) ?? Promise.resolve(),

    /** The session is gone. */
    clear(sessionId) { queues.delete(sessionId); held.delete(sessionId); starting.delete(sessionId); },
  };
}
