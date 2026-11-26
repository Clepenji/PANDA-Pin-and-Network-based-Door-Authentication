/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_SIMULATOR?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
