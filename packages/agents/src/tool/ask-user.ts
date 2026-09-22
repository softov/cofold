import type { AskAnswers, AskQuestion } from '../types/ask.js';
import type { Tool } from '../types/tool.js';
import { pauseForInput } from '../run/pause.js';
import type { JsonSchema } from '@doopx/sdk';
import { createTool } from './create-tool.js';

const QUESTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', description: 'Key of the answer; unique within this call.' },
    question: { type: 'string', minLength: 1 },
    header: { type: 'string', maxLength: 12, description: 'Short label a UI shows as a chip.' },
    options: {
      type: 'array', minItems: 2, maxItems: 8,
      items: { type: 'object', properties: { label: { type: 'string', minLength: 1 }, description: { type: 'string' } }, required: ['label'], additionalProperties: false },
    },
    multiSelect: { type: 'boolean', description: 'The answer is a list of option labels. Only with options.' },
    allowOther: { type: 'boolean', description: 'Free text accepted even when options are given. Default true.' },
  },
  required: ['id', 'question'],
  additionalProperties: false,
};

/**
 * The structured question primitive (decision 69). Not added to any agent by default (decision 7):
 * pass it in `tools` and answer with `submit({ type: 'answer', answers })` on the resumed handle.
 */
export function createAskUserTool(options: { name?: string; description?: string } = {}): Tool<{ questions: AskQuestion[] }> {
  return createTool<{ questions: AskQuestion[] }>({
    name: options.name ?? 'ask_user',
    description: options.description ?? 'Ask the user one or more questions and wait for the answers. Use options for choices; leave options out for free text.',
    input: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 4, items: QUESTION_SCHEMA } }, required: ['questions'], additionalProperties: false },
    effects: {},
    execute: (input) => {
      const ids = new Set<string>();
      for (const q of input.questions) {
        if (ids.has(q.id)) throw new Error(`duplicate question id "${q.id}"`);
        ids.add(q.id);
        if (q.multiSelect && !q.options) throw new Error(`question "${q.id}": multiSelect needs options`);
      }
      return pauseForInput({ questions: input.questions });
    },
  });
}

/** Validates host answers against the questions (decision 77). Returns the issues, empty when valid. */
export function validateAnswers(questions: AskQuestion[], answers: AskAnswers): string[] {
  const issues: string[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) if (!byId.has(id)) issues.push(`unknown question "${id}"`);
  for (const q of questions) {
    const a = answers[q.id];
    if (a === undefined) { issues.push(`missing answer for "${q.id}"`); continue; }
    const values = Array.isArray(a) ? a : [a];
    if (Array.isArray(a) && !q.multiSelect) issues.push(`"${q.id}" is single-select`);
    if (values.length === 0 || values.some((v) => typeof v !== 'string' || !v.trim())) issues.push(`"${q.id}" needs a non-empty answer`);
    if (q.options && q.allowOther === false) {
      const labels = new Set(q.options.map((o) => o.label));
      for (const v of values) if (!labels.has(v)) issues.push(`"${q.id}": "${v}" is not one of the options`);
    }
  }
  return issues;
}

/** What the model sees as the tool result. */
export function renderAnswers(questions: AskQuestion[], answers: AskAnswers): string {
  return questions.map((q) => {
    const a = answers[q.id];
    return `Q (${q.id}): ${q.question}\nA: ${Array.isArray(a) ? a.join(', ') : a}`;
  }).join('\n\n');
}
