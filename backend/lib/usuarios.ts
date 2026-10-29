// Regras de conta compartilhadas entre a API e os scripts de linha de comando (sem dependência do servidor)

export type Papel = 'admin' | 'supervisor' | 'collaborator' | 'receptionist';
export const PAPEIS_VALIDOS: Papel[] = ['admin', 'supervisor', 'collaborator', 'receptionist'];

// Papéis que atendem clientes: só eles recebem agendamentos (e, por eles, acesso à anamnese)
export const PAPEIS_ATENDIMENTO = ['collaborator', 'colaborador'];

export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 128;

export const validarSenha = (senha: unknown): string | null => {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > SENHA_MAXIMA) return `A senha deve ter no máximo ${SENHA_MAXIMA} caracteres.`;
  return null;
};

// Some ao update de quem troca senha/e-mail ou reativa a conta: derruba todos os tokens já emitidos (ver validarSessao)
export const INVALIDAR_SESSOES = { versaoToken: { increment: 1 } } as const;
