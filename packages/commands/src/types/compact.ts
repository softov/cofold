export type Compacted<T> = { [Key in keyof T]?: Exclude<T[Key], undefined> };
