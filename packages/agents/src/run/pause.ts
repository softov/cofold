import type { AskQuestion } from '../types/ask.js';

/** Thrown by a tool to pause the run for human input; the loop turns it into an 'input' pending request (decision 72). */
export class PauseSignal extends Error {
  readonly questions: AskQuestion[];
  constructor(questions: AskQuestion[]) {
    super('pause for input');
    this.name = 'PauseSignal';
    this.questions = questions;
  }
}

export function pauseForInput(args: { questions: AskQuestion[] }): never {
  throw new PauseSignal(args.questions);
}
