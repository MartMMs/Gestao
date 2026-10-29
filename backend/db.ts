import { PrismaClient } from '@prisma/client';

// Cliente único do Prisma para toda a API.
// O hash da senha nunca sai do banco por padrão; só o login pede explicitamente com `omit: { senha: false }`.
export const prisma = new PrismaClient({
  omit: { colaborador: { senha: true } },
});
