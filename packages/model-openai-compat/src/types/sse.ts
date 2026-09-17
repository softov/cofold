/** One server-sent event: the `data:` lines joined with '\n', and the `event:` name when the server sent one. */
export interface SseEvent {
  event?: string;
  data: string;
}
