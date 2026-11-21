import { describe, expect, it } from "vitest";
import { keysOf } from "./keys.js";

const DOWN = "\x1b[B";
const ESC = "\x1b";

describe("keys", () => {
  it("reads several keys from one chunk", () => {
    expect(keysOf(`${DOWN}${DOWN} \r`).map((key) => key.name)).toEqual(["down", "down", "space", "enter"]);
  });

  it("drops an escape sequence it does not know instead of typing its tail", () => {
    expect(keysOf("\x1b[15~a").map((key) => key.name)).toEqual(["char"]);
  });

  it("reads a lone escape as the escape key", () => {
    expect(keysOf(ESC).map((key) => key.name)).toEqual(["escape"]);
  });
});
