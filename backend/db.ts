import { PrismaClient } from '@prisma/client';

// Cliente único do Prisma para toda a API.
// O hash da senha e a versão do token (que invalida sessões) nunca saem do banco por padrão; só o login pede
// explicitamente com `omit: { senha: false, versaoToken: false }` (e a checagem do token, com `select`).
export const prisma = new PrismaClient({
  // As listas de habilidades em texto (antes da tabela Habilidade) ficam no banco só para voltar de versão: não saem
  omit: {
    colaborador: { senha: true, versaoToken: true, habilidadesLegado: true },
    servico: { habilidadesPermitidasLegado: true },
  },
});
