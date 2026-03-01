import type { FileNode } from '../filesystem/types';

// XOR key for encoding filesystem content at build time. This is an anti-cheat measure
// to prevent players from finding sensitive strings by searching the JS bundle.
// The value itself is arbitrary — changing it would invalidate any previously encoded data.
const CODEC_KEY = 'JSHACK_CTF';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const keyBytes = encoder.encode(CODEC_KEY);

const xorBytes = (data: Uint8Array): Uint8Array =>
  Uint8Array.from(data, (byte, i) => byte ^ keyBytes[i % keyBytes.length]);

const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

const fromBase64 = (str: string): Uint8Array => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export const encodeContent = (plain: string): string => toBase64(xorBytes(encoder.encode(plain)));

export const decodeContent = (encoded: string): string =>
  decoder.decode(xorBytes(fromBase64(encoded)));

const transformContent = (node: FileNode, transform: (content: string) => string): FileNode => ({
  ...node,
  content: node.content !== undefined ? transform(node.content) : undefined,
  children: node.children
    ? Object.fromEntries(
        Object.entries(node.children).map(([key, child]) => [
          key,
          transformContent(child, transform),
        ]),
      )
    : undefined,
});

export const encodeFileSystem = (root: FileNode): FileNode => transformContent(root, encodeContent);

export const decodeFileSystem = (root: FileNode): FileNode => transformContent(root, decodeContent);
