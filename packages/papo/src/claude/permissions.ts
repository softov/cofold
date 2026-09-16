import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
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
 * form, any other tool as the confirmation, with `always` offered when the CLI suggested a rule.
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
    confirmationTitle: `Run ${decision.toolName}?`,
    options: decision.suggestions.length > 0 ? [{ id: ALWAYS, label: 'Always, this session' }] : [],
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

export function approval(decision: ClaudeDecision, always: boolean): PermissionResult {
  return { behavior: 'allow', updatedInput: decision.input, ...(always && decision.suggestions.length > 0 ? { updatedPermissions: decision.suggestions } : {}) };
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
