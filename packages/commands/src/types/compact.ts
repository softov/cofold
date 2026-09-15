/** An object whose optional fields are present only when defined; what `compact()` returns. */
export type Compacted<T> = { [Key in keyof T]?: Exclude<T[Key], undefined> };
