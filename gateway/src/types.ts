/** Plain data type describing the outcome of a tool call. */
export type ToolCallOutcome =
  | { kind: "success"; durationMs: number }
  | { kind: "tool_error"; durationMs: number; error: string }
  | { kind: "exception"; durationMs: number; error: string; code: string };
