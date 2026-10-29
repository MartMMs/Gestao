// Variáveis de build do Vite. Acesso direto a import.meta.env: é o padrão que o Vite substitui no build
// (com cast, "(import.meta).env" ficava sem substituição e as variáveis eram ignoradas em produção).
export const readEnv = () => import.meta.env;
