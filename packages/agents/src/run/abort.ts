import type { AbortReason, RunAbort } from '../types/abort.js';

export function createRunAbort(args: { external?: AbortSignal; timeoutMs: number }): RunAbort {
  const controller = new AbortController();
  let reason: AbortReason | undefined;
  const abort = (r: AbortReason) => {
    if (controller.signal.aborted) return;
    reason = r;
    controller.abort(r);
  };
  const onExternal = () => abort({ kind: 'cancel', reason: 'signal' });
  if (args.external) {
    if (args.external.aborted) onExternal();
    else args.external.addEventListener('abort', onExternal, { once: true });
  }
  // The timer would keep the process alive for timeoutMs after a normal finish; dispose() clears it.
  const timer = args.timeoutMs > 0 ? setTimeout(() => abort({ kind: 'timeout' }), args.timeoutMs) : undefined;
  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    args.external?.removeEventListener('abort', onExternal);
  };
  controller.signal.addEventListener('abort', dispose, { once: true });
  return {
    signal: controller.signal,
    abort,
    dispose,
    reason: () => reason,
    aborted: () =>
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(reason);
        else controller.signal.addEventListener('abort', () => reject(reason), { once: true });
      }),
  };
}
