import type { PromptMarks } from "../types/prompts.js";

const UNICODE: PromptMarks = {
  bar: "│", active: "◆", done: "◇", end: "└", cancelled: "■",
  checked: "◉", unchecked: "◯", selected: "●", unselected: "○", pointer: "❯",
};

/** Every mark one character wide, for a terminal that cannot draw the others. */
const ASCII: PromptMarks = {
  bar: "|", active: "*", done: "o", end: "'", cancelled: "x",
  checked: "[x]", unchecked: "[ ]", selected: "(*)", unselected: "( )", pointer: ">",
};

export function marksFor(unicode: boolean): PromptMarks {
  return unicode ? UNICODE : ASCII;
}
