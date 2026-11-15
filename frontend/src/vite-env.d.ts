/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_AUTOATENDIMENTO_HOST?: string;
  readonly VITE_TV_HOST?: string;
  // "1": /totem e /painel abrem pelo caminho no build de produção (teste pelo IP, sem isolamento de sessão)
  readonly VITE_ATALHO_CAMINHOS?: string;
  readonly VITE_AUTOATENDIMENTO_URL?: string;
  readonly VITE_TV_LATITUDE?: string;
  readonly VITE_TV_LONGITUDE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}