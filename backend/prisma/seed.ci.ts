/**
 * Dados minimos para Playwright/CI (colaborador + servico dedicados).
 * Uso: DATABASE_URL=... npx tsx prisma/seed.ci.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  // Contas de teste com e-mails conhecidos nunca podem ir para um banco de produção
  if (process.env.NODE_ENV === 'production') throw new Error('O seed de CI não pode rodar com NODE_ENV=production.');
  // Senha dos usuários de teste vem do ambiente (CI define E2E_PASSWORD); nunca fixa no código
  const senha = process.env.E2E_PASSWORD;
  if (!senha || senha.length < 8) throw new Error('Defina E2E_PASSWORD (mínimo 8 caracteres).');
  const hash = await bcrypt.hash(senha, 10);

  const usuarios = [
    { nome: 'Admin E2E', email: 'admin@serenidade.com', papel: 'admin', especialidade: 'Gestão' },
    { nome: 'Supervisor E2E', email: 'supervisor@serenidade.com', papel: 'supervisor', especialidade: 'Coordenação' },
    { nome: 'Helena E2E', email: 'helena@serenidade.com', papel: 'collaborator', especialidade: 'Massagem' },
    { nome: 'Ana E2E', email: 'ana@serenidade.com', papel: 'collaborator', especialidade: 'Massagem' },
  ];
  for (const usuario of usuarios) {
    await prisma.colaborador.upsert({
      where: { email: usuario.email },
      create: { ...usuario, senha: hash, ativo: true },
      update: { senha: hash, ativo: true, papel: usuario.papel },
    });
  }

  await prisma.servico.upsert({
    where: { nome: 'E2E Massagem' },
    create: { nome: 'E2E Massagem', preco: 0, duracao: 60 },
    update: { duracao: 60, preco: 0 },
  });

  if ((await prisma.sala.count({ where: { ativa: true } })) === 0) {
    await prisma.sala.create({ data: { nome: 'Sala E2E', numero: 1 } });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
