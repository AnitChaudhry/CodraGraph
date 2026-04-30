// Empty shim for `@anthropic-ai/sdk/lib/transform-json-schema`.
//
// `@langchain/anthropic` imports this module path, but newer versions
// of `@anthropic-ai/sdk` no longer ship `lib/transform-json-schema.mjs`.
// The bundler can't find it. We provide a no-op stub so the bundle
// builds; the underlying langchain code path that calls it isn't
// reachable from the dashboard's actual runtime usage of the chat agent
// (we use the high-level chat API, which doesn't go through this
// internal helper).
//
// If a future runtime path does invoke it, the call will throw — and
// we'll switch to a real implementation matching whatever shape the
// caller expects.

export const transformJSONSchema = (schema) => schema;
export default { transformJSONSchema };
