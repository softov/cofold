import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { AskAnswers, AskQuestion } from '@facio/agents';
import type { ChatPendingInput, ChatToolCall } from '@textui/chat';
import { toChatQuestion } from '../questions.js';
import { inputLine, ALWAYS } from '../turns.js';
import type { ClaudeDecision } from '../types/claude.js';

/** The CLI's question tool; it reaches the host through `canUseTool` and is answered in `updatedInput.answers`. */
export const ASK_TOOL = 'AskUserQuestion';

interface ClaudeQuestion {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/**
 * A `canUseTool` call as the block papo shows (CLI-03 decision 5): `AskUserQuestion` as the question
 * form, any other tool as the confirmation under the CLI's own sentence when it sent one, with `always`
 * offered when the CLI suggested a rule and did not ask for the option to be withheld.
 */
export function pendingOf(decision: ClaudeDecision): ChatPendingInput {
  if (decision.toolName === ASK_TOOL) {
    const questions = (decision.input['questions'] as ClaudeQuestion[] | undefined) ?? [];
    return {
      kind: 'chatInput',
      id: decision.requestId,
      message: 'Claude is asking',
      questions: questions.map((question) => toChatQuestion(askQuestionOf(question))),
    };
  }
  const call: ChatToolCall = {
    id: decision.toolUseId,
    name: decision.toolName,
    status: 'pending-confirmation',
    input: inputLine({ input: decision.input, raw: '' }),
    confirmationTitle: decision.title ?? `Run ${decision.toolName}?`,
    options: decision.suggestions.length > 0 && !decision.suppressAlways ? [{ id: ALWAYS, label: 'Always, this session' }] : [],
  };
  return { kind: 'toolConfirmation', id: decision.toolUseId, call };
}

/** The CLI's question as the harness's: the question text is the id, because that is how the answer is keyed. */
function askQuestionOf(question: ClaudeQuestion): AskQuestion {
  return {
    id: question.question,
    question: question.question,
    header: question.header,
    options: question.options.map((option) => ({ label: option.label, ...(option.description !== undefined ? { description: option.description } : {}) })),
    multiSelect: question.multiSelect === true,
    allowOther: true,
  };
}

/**
 * The allow, with the CLI's suggested rules sent back on `always`, every one rewritten to the session:
 * the button says "this session", and nothing is written into a settings file (review R4).
 */
export function approval(decision: ClaudeDecision, always: boolean): PermissionResult {
  const rules = always && !decision.suppressAlways ? decision.suggestions.map((rule): PermissionUpdate => ({ ...rule, destination: 'session' })) : [];
  return { behavior: 'allow', updatedInput: decision.input, ...(rules.length > 0 ? { updatedPermissions: rules } : {}) };
}

export function denial(reason: string): PermissionResult {
  return { behavior: 'deny', message: reason };
}

/** The answers back into the tool's input, keyed by question text; a multi-select is comma-separated, as the CLI expects. */
export function answered(decision: ClaudeDecision, answers: AskAnswers): PermissionResult {
  const flat: Record<string, string> = {};
  for (const [id, value] of Object.entries(answers)) flat[id] = Array.isArray(value) ? value.join(', ') : value;
  return { behavior: 'allow', updatedInput: { ...decision.input, answers: flat } };
}
