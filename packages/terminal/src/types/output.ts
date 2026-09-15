export type OutputMode = "plain" | "json" | "quiet";

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  heading(text: string): string;
}
