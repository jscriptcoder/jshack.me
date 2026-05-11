import type { FileNode } from './types';

// Overlay projected-path content from machine_filesystems onto a freshly
// regenerated FileNode tree.
//
// Why this exists: cross-player getBaseFs regens the workstation FS via
// generateLocalhost using the workstation row's seed AND a placeholder
// rootPassword (because the real rootPassword is intentionally NOT
// persisted server-side). The /etc/passwd content this regen produces
// would have the WRONG hash for everything credential-dependent.
// Cross-player auth reads /etc/passwd from machine_filesystems' projected
// content — that has the REAL hash. This helper makes the FileNode tree
// A receives match the FS the server's auth path actually validated
// against.
//
// Pure recursion; produces a structurally-fresh tree for any node whose
// content differs from the input. Nodes whose path is not in the
// overlay map are returned unchanged (including their references —
// callers can take advantage if their identity-equality compare needs
// it, but it's not load-bearing for correctness).
//
// Not an "insert" — overlay entries whose path is absent from the tree
// are silently ignored. The regen result is the structural source of
// truth; the overlay only changes content for paths that already exist.

const joinPath = (basePath: string, name: string): string =>
  basePath === '/' ? `/${name}` : `${basePath}/${name}`;

export const overlayProjectedContent = (
  node: FileNode,
  contentByPath: ReadonlyMap<string, string>,
  basePath = '/',
): FileNode => {
  if (node.type === 'directory') {
    if (!node.children) return node;
    const overlaidChildren: Record<string, FileNode> = {};
    let anyChanged = false;
    for (const [name, child] of Object.entries(node.children)) {
      const childPath = joinPath(basePath, name);
      const overlaid = overlayProjectedContent(child, contentByPath, childPath);
      overlaidChildren[name] = overlaid;
      if (overlaid !== child) anyChanged = true;
    }
    return anyChanged ? { ...node, children: overlaidChildren } : node;
  }

  // File node — substitute content if its exact path is in the overlay.
  const replacement = contentByPath.get(basePath);
  if (replacement === undefined || replacement === node.content) return node;
  return { ...node, content: replacement };
};
