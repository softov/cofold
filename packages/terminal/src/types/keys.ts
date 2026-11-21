/** A key, as a person pressed it. */
export interface TerminalKey {
  /** `up`, `down`, `left`, `right`, `home`, `end`, `enter`, `space`, `escape`, `backspace`, `ctrl-c`, `ctrl-d`, or `char`. */
  name: string;
  /** The character, for `char` and `space`. */
  char?: string;
}
