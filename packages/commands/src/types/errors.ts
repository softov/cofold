export type FaultKind =
  | "argument"      /* the person typed something wrong */
  | "configuration" /* the machine is not set up */
  | "authorization" /* set up, but not allowed */
  | "unavailable"   /* something upstream is not answering */
  | "conflict"      /* the request was understood and refused */
  | "internal";
