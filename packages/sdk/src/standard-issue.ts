/** One issue a Standard Schema reports; the path is the specification's shape, not a string. */
export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}
