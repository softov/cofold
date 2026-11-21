import { describe, expect, it } from "vitest";
import { colorSupported, glyphsFor, paintFor, unicodeSupported } from "./glyphs.js";

describe("glyphs", () => {
  it("reads unicode support from the environment and platform", () => {
    expect(unicodeSupported({ LANG: "en_US.UTF-8" }, "linux")).toBe(true);
    expect(unicodeSupported({ LANG: "C" }, "linux")).toBe(false);
    expect(unicodeSupported({ TERM: "linux" }, "linux")).toBe(false);
    expect(unicodeSupported({}, "win32")).toBe(false);
    expect(unicodeSupported({ WT_SESSION: "x" }, "win32")).toBe(true);
  });

  it("gives one-width marks where unicode cannot be drawn", () => {
    expect(glyphsFor(true).ok).toBe("✓");
    expect(glyphsFor(false).ok).toBe("+");
  });

  it("reads colour from NO_COLOR, FORCE_COLOR, a dumb terminal and a pipe", () => {
    expect(colorSupported({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    expect(colorSupported({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(colorSupported({ TERM: "dumb" }, true)).toBe(false);
    expect(colorSupported({}, true)).toBe(true);
    expect(colorSupported({}, false)).toBe(false);
  });

  it("paints only when colour is on", () => {
    expect(paintFor(false).green("x")).toBe("x");
    expect(paintFor(true).green("x")).toBe("\x1b[32mx\x1b[39m");
  });
});
