/** One issue with a value against its schema, at a dotted path (`$`, `$.name`, `$.items[2]`). */
export interface SchemaIssue {
  path: string;
  message: string;
}
