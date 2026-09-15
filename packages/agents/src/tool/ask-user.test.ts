import type { AskQuestion } from '../types/ask.js';
import type { ToolContext } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { PauseSignal } from '../run/pause.js';
import { validateSchema } from '@facio/sdk';
import { createAskUserTool, renderAnswers, validateAnswers } from './ask-user.js';

const tool = createAskUserTool();
const ctx = {} as ToolContext;
const single: AskQuestion = { id: 'lang', question: 'Which language?', options: [{ label: 'TypeScript' }, { label: 'Rust', description: 'fast' }], allowOther: false };
const multi: AskQuestion = { id: 'targets', question: 'Which targets?', header: 'Targets', options: [{ label: 'node' }, { label: 'browser' }, { label: 'deno' }], multiSelect: true };
const free: AskQuestion = { id: 'name', question: 'Project name?' };

describe('createAskUserTool', () => {
  it('has the default name and a schema that bounds the questions', () => {
    expect(tool.name).toBe('ask_user');
    expect(tool.effects).toEqual({});
    expect(createAskUserTool({ name: 'ask', description: 'd' }).name).toBe('ask');
    expect(validateSchema({ schema: tool.input, value: { questions: [] } }).ok).toBe(false);
    expect(validateSchema({ schema: tool.input, value: { questions: [free, free, free, free, free] } }).ok).toBe(false);
    expect(validateSchema({ schema: tool.input, value: { questions: [{ id: 'x', question: 'q', options: [{ label: 'only' }] }] } }).ok).toBe(false);
    expect(validateSchema({ schema: tool.input, value: { questions: [{ id: 'bad id', question: 'q' }] } }).ok).toBe(false);
    expect(validateSchema({ schema: tool.input, value: { questions: [single, multi, free] } }).ok).toBe(true);
  });

  it('execute throws a PauseSignal carrying the questions', () => {
    let caught: unknown;
    try { tool.execute({ questions: [single, free] }, ctx); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PauseSignal);
    expect((caught as PauseSignal).questions).toEqual([single, free]);
  });

  it('rejects duplicate ids and multiSelect without options with a plain Error', () => {
    expect(() => tool.execute({ questions: [free, free] }, ctx)).toThrow(/duplicate question id "name"/);
    expect(() => tool.execute({ questions: [{ id: 'm', question: 'q', multiSelect: true }] }, ctx)).toThrow(/multiSelect needs options/);
    let caught: unknown;
    try { tool.execute({ questions: [free, free] }, ctx); } catch (e) { caught = e; }
    expect(caught).not.toBeInstanceOf(PauseSignal);
  });
});

describe('validateAnswers', () => {
  const questions = [single, multi, free];
  it('accepts a complete, well-shaped answer set', () => {
    expect(validateAnswers(questions, { lang: 'Rust', targets: ['node', 'deno'], name: 'facio' })).toEqual([]);
    expect(validateAnswers([multi], { targets: ['anything'] })).toEqual([]);
  });
  it('reports each issue', () => {
    expect(validateAnswers(questions, { lang: 'Rust', targets: ['node'], name: 'x', extra: 'y' })).toEqual(['unknown question "extra"']);
    expect(validateAnswers(questions, { lang: 'Rust', targets: ['node'] })).toEqual(['missing answer for "name"']);
    expect(validateAnswers([single], { lang: 'Go' })).toEqual(['"lang": "Go" is not one of the options']);
    expect(validateAnswers([single], { lang: ['Rust'] })).toEqual(['"lang" is single-select']);
    expect(validateAnswers([multi], { targets: [] })).toEqual(['"targets" needs a non-empty answer']);
    expect(validateAnswers([free], { name: '  ' })).toEqual(['"name" needs a non-empty answer']);
    expect(validateAnswers([free], { name: 3 as unknown as string })).toEqual(['"name" needs a non-empty answer']);
  });
});

describe('renderAnswers', () => {
  it('renders one block per question in question order', () => {
    expect(renderAnswers([single, multi], { targets: ['node', 'deno'], lang: 'Rust' })).toBe(
      'Q (lang): Which language?\nA: Rust\n\nQ (targets): Which targets?\nA: node, deno',
    );
  });
});
