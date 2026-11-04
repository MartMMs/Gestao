// Regra de senha da API e da tela de troca de senha
export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 128;

export const validarSenha = (senha: unknown): string | null => {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > SENHA_MAXIMA) return `A senha deve ter no máximo ${SENHA_MAXIMA} caracteres.`;
  return null;
};
