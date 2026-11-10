import type { AskAnswers } from '@cofold/agents';
import type { ChatInputRequest, ChatQuestion, ChatToolConfirmation } from '@textui/chat';
import { ALWAYS } from '../turns.js';
import type { ElicitationProperty, ElicitationResponse, ElicitationSchema, PermissionOption, RequestPermissionOutcome, ToolCallUpdate } from '../types/acp.js';
import { kindOf, statusOf, titleOf } from './tools.js';

const ALLOW = 'allow';
const REJECT = 'reject';

/** The confirmation as `session/request_permission` asks it: allow, always where the block offers it, reject. */
export function permissionOf(block: ChatToolConfirmation): { toolCall: ToolCallUpdate; options: PermissionOption[] } {
  const { call } = block;
  const always = call.options?.some((option) => option.id === ALWAYS) === true;
  return {
    toolCall: { toolCallId: call.id, title: call.confirmationTitle ?? titleOf(call), kind: kindOf(call.toolName ?? call.name), status: statusOf(call.status) },
    options: [
      { optionId: ALLOW, name: 'Allow', kind: 'allow_once' },
      ...(always ? [{ optionId: ALWAYS, name: 'Always, this session', kind: 'allow_always' as const }] : []),
      { optionId: REJECT, name: 'Reject', kind: 'reject_once' },
    ],
  };
}

/** What the client chose, as the service takes it; a cancelled request is a denial. */
export function decisionOf(outcome: RequestPermissionOutcome | undefined): { approve: boolean; always?: true } {
  if (outcome?.outcome !== 'selected') return { approve: false };
  if (outcome.optionId === ALLOW) return { approve: true };
  if (outcome.optionId === ALWAYS) return { approve: true, always: true };
  return { approve: false };
}

/**
 * The question block as an elicitation form. A field is keyed `q1`, `q2`, ... rather than by the question's
 * id, which on the claude backend is the question's whole text. A select that also takes free text is sent
 * as its options only: the form's schema has no "one of these, or your own words".
 */
export function formOf(block: ChatInputRequest): { message: string; requestedSchema: ElicitationSchema; keys: Map<string, string> } {
  const properties: Record<string, ElicitationProperty> = {};
  const keys = new Map<string, string>();
  const required: string[] = [];
  block.questions.forEach((question, index) => {
    const key = `q${index + 1}`;
    keys.set(key, question.id);
    properties[key] = propertyOf(question);
    if (question.required === true) required.push(key);
  });
  return { message: block.message, requestedSchema: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }, keys };
}

function propertyOf(question: ChatQuestion): ElicitationProperty {
  const choices = question.options?.map((option) => ({ const: option.label, title: option.label }));
  if (question.kind === 'multi-select' && choices !== undefined) return { type: 'array', title: question.message, items: { anyOf: choices } };
  if (choices !== undefined) return { type: 'string', title: question.message, oneOf: choices };
  return { type: 'string', title: question.message };
}

/** An accepted form as the service's answers; undefined when the client declined or cancelled. */
export function answersOf(response: ElicitationResponse | undefined, keys: Map<string, string>): AskAnswers | undefined {
  if (response?.action !== 'accept') return undefined;
  const content = 'content' in response ? response.content ?? {} : {};
  const answers: AskAnswers = {};
  for (const [key, id] of keys) {
    const value = content[key];
    if (value === undefined || value === '') continue;
    answers[id] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return answers;
}
