/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_AUTOATENDIMENTO_HOST?: string;
  readonly VITE_AUTOATENDIMENTO_URL?: string;
  readonly VITE_TV_LATITUDE?: string;
  readonly VITE_TV_LONGITUDE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}