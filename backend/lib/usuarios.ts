// Regras de conta compartilhadas entre a API e os scripts de linha de comando (sem dependência do servidor)

export type Papel = 'admin' | 'supervisor' | 'collaborator' | 'receptionist';

export const PAPEIS_VALIDOS: Papel[] = ['admin', 'supervisor', 'collaborator', 'receptionist'];

// Papéis que atendem clientes: só eles recebem agendamentos (e, por eles, acesso à anamnese)
export const PAPEIS_ATENDIMENTO = ['collaborator', 'colaborador'];

export { SENHA_MINIMA, SENHA_MAXIMA, validarSenha } from '../../shared/senha';

// Some ao update de quem troca senha/e-mail ou reativa a conta: derruba todos os tokens já emitidos (ver validarSessao)
export const INVALIDAR_SESSOES = { versaoToken: { increment: 1 } } as const;
