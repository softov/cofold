import type { RunEvent, RunEventBody } from './event.js';

export interface Emitter {
  emit(body: RunEventBody): Promise<RunEvent>;
  seq(): number;
}
