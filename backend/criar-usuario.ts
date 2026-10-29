/**
 * Cria um usuário com senha (substitui os antigos logins fixos no código).
 *
 * Uso:
 *   npm --prefix backend run criar-usuario -- --email admin@empresa.com --nome "Maria Souza" --papel admin
 *
 * A senha é digitada no terminal (não fica no histórico do shell). Com --gerar-senha, uma senha forte
 * é gerada e mostrada uma única vez. Para redefinir a senha/papel de uma conta existente, use --sobrescrever.
 */
import './env';
import crypto from 'node:crypto';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { INVALIDAR_SESSOES, PAPEIS_VALIDOS, validarSenha, type Papel } from './lib/usuarios';

const lerArgumento = (nome: string) => {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const temOpcao = (nome: string) => process.argv.includes(`--${nome}`);

// Lê a senha sem ecoar no terminal
const perguntarSenha = (pergunta: string) => new Promise<string>((resolve, reject) => {
  if (!process.stdin.isTTY) return reject(new Error('Rode em um terminal interativo ou use --gerar-senha.'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const saida = rl as unknown as { _writeToOutput: (texto: string) => void };
  saida._writeToOutput = (texto) => { if (texto.includes(pergunta)) process.stdout.write(texto); };
  rl.question(pergunta, (resposta) => {
    rl.close();
    process.stdout.write('\n');
    resolve(resposta);
  });
});

async function main() {
  const email = lerArgumento('email')?.trim().toLowerCase();
  const nome = lerArgumento('nome')?.trim() || 'Administrador';
  const papel = (lerArgumento('papel') || 'admin') as Papel;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe --email com um e-mail válido.');
  if (!PAPEIS_VALIDOS.includes(papel)) throw new Error(`--papel deve ser um de: ${PAPEIS_VALIDOS.join(', ')}.`);

  const existente = await prisma.colaborador.findUnique({ where: { email } });
  if (existente && !temOpcao('sobrescrever')) {
    throw new Error(`Já existe uma conta com ${email} (papel ${existente.papel}${existente.ativo ? '' : ', desativada'}). `
      + 'Use --sobrescrever para redefinir a senha e o papel dela.');
  }

  const senhaGerada = temOpcao('gerar-senha');
  let senha: string;
  if (senhaGerada) {
    senha = crypto.randomBytes(12).toString('base64url');
  } else {
    senha = await perguntarSenha('Senha: ');
    if ((await perguntarSenha('Repita a senha: ')) !== senha) throw new Error('As senhas não conferem.');
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) throw new Error(erroSenha);

  const hash = await bcrypt.hash(senha, 10);
  const usuario = existente
    ? await prisma.colaborador.update({ where: { id: existente.id }, data: { papel, senha: hash, ativo: true, ...INVALIDAR_SESSOES } })
    : await prisma.colaborador.create({
      data: { nome, email, papel, senha: hash, especialidade: papel === 'admin' ? 'Gestão' : '', ativo: true },
    });

  if (existente && existente.papel !== papel) console.log(`⚠️  Papel de ${email} alterado de ${existente.papel} para ${papel}.`);
  if (existente && !existente.ativo) console.log(`⚠️  A conta ${email} estava desativada e foi reativada.`);
  console.log(`✅ Usuário ${usuario.email} (${papel}) pronto.`);
  if (senhaGerada) console.log(`🔑 Senha gerada (anote agora, ela não será mostrada de novo): ${senha}`);
}

main()
  .catch((error) => {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
