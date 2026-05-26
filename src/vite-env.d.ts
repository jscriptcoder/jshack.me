/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SHOW_REWORK_NOTICE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
