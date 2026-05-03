// Plain-TS home for session-level types so non-React consumers
// (handler/walker/api) can import them without dragging the JSX-dependent
// SessionContext.tsx through the tsconfig.node.json graph (which has no
// `jsx` setting and rejects .tsx files under `tsc -b`).

export type UserType = 'root' | 'user' | 'guest';
