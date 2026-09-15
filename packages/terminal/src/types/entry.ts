export interface EntryOptions {
  /**
   * Everything this installation knows that must never be printed.
   *
   * A token appears in an error message the day a request fails with the URL it
   * was sent to. Redaction belongs at the last edge rather than at each place a
   * message is built, because the messages are written by people who are
   * thinking about something else.
   */
  secrets?(): readonly (string | undefined)[];
  /** For a program that logs somewhere as well as printing. */
  onError?(error: unknown): void;
}
