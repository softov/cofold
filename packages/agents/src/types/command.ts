export type RunCommand =
  | { type: 'approve'; requestId: string }
  | { type: 'deny'; requestId: string; reason?: string }
  | { type: 'answer'; requestId: string; text: string }
  | { type: 'cancel'; reason?: string };
