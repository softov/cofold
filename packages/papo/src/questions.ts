import type { AskAnswers, AskQuestion } from '@facio/agents';
import type { ChatAnswer, ChatQuestion } from '@textui/chat';

/** The harness's question, as the question form draws it. */
export function toChatQuestion(question: AskQuestion): ChatQuestion {
  const options = question.options?.map((option) => ({ id: option.label, label: option.label }));
  return {
    id: question.id,
    kind: options === undefined ? 'text' : question.multiSelect ? 'multi-select' : 'single-select',
    message: question.header !== undefined ? `${question.header}: ${question.question}` : question.question,
    required: true,
    ...(options !== undefined ? { options } : {}),
    allowFreeformInput: question.allowOther !== false,
  };
}

/** The form's answers, as `submit({ type: 'answer' })` takes them; a blank answer is left out. */
export function toAskAnswers(answers: Record<string, ChatAnswer>): AskAnswers {
  const out: AskAnswers = {};
  for (const [id, answer] of Object.entries(answers)) {
    switch (answer.kind) {
      case 'selected-many': out[id] = answer.value; break;
      case 'selected': case 'text': if (answer.value !== '') out[id] = answer.value; break;
      case 'number': case 'boolean': out[id] = String(answer.value); break;
    }
  }
  return out;
}

/** `id=value` words from a shell, as answers; a repeated id becomes a list. */
export function parseAnswers(words: readonly string[]): AskAnswers {
  const out: AskAnswers = {};
  for (const word of words) {
    const at = word.indexOf('=');
    if (at <= 0) throw new Error(`answer "${word}" must be written id=value`);
    const id = word.slice(0, at);
    const value = word.slice(at + 1);
    const held = out[id];
    out[id] = held === undefined ? value : Array.isArray(held) ? [...held, value] : [held, value];
  }
  return out;
}
