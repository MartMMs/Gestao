/**
 * Cria um usuário com senha (substitui os antigos logins fixos no código).
 *
 * Uso:
 *   npm --prefix backend run criar-usuario -- --usuario maria.souza --nome "Maria Souza" --papel admin
 *   (ou --email admin@empresa.com; pode passar os dois. A conta existente é achada pelo usuário ou pelo e-mail)
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
import { EMAIL_REGEX, MENSAGEM_USUARIO_INVALIDO, USUARIO_REGEX } from '../shared/validadores';

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
  const email = lerArgumento('email')?.trim().toLowerCase() || null;
  const usuarioAcesso = lerArgumento('usuario')?.trim().toLowerCase() || null;
  const nome = lerArgumento('nome')?.trim() || 'Administrador';
  const papel = (lerArgumento('papel') || 'admin') as Papel;

  if (!email && !usuarioAcesso) throw new Error('Informe --usuario (ou --email) da conta.');
  if (email && !EMAIL_REGEX.test(email)) throw new Error('Informe --email com um e-mail válido.');
  if (usuarioAcesso && !USUARIO_REGEX.test(usuarioAcesso)) throw new Error(MENSAGEM_USUARIO_INVALIDO);
  const login = usuarioAcesso || email;
  if (!PAPEIS_VALIDOS.includes(papel)) throw new Error(`--papel deve ser um de: ${PAPEIS_VALIDOS.join(', ')}.`);

  const existentes = await prisma.colaborador.findMany({
    where: { OR: [...(usuarioAcesso ? [{ usuario: usuarioAcesso }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])] },
  });
  // Usuário de uma conta e e-mail de outra: sobrescrever juntaria as duas
  if (existentes.length > 1) throw new Error('O usuário e o e-mail informados pertencem a contas diferentes.');
  const existente = existentes[0];
  if (existente && !temOpcao('sobrescrever')) {
    throw new Error(`Já existe uma conta com ${login} (papel ${existente.papel}${existente.ativo ? '' : ', desativada'}). `
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
    ? await prisma.colaborador.update({
      where: { id: existente.id },
      data: { papel, senha: hash, ativo: true, trocarSenha: senhaGerada, ...(usuarioAcesso ? { usuario: usuarioAcesso } : {}), ...(email ? { email } : {}), ...INVALIDAR_SESSOES },
    })
    : await prisma.colaborador.create({
      // Senha gerada aparece no terminal (pode ter sido vista por outra pessoa): troca obrigatória no 1º acesso
      data: { nome, email, usuario: usuarioAcesso, papel, senha: hash, especialidade: papel === 'admin' ? 'Gestão' : '', ativo: true, trocarSenha: senhaGerada },
    });

  if (existente && existente.papel !== papel) console.log(`⚠️  Papel de ${login} alterado de ${existente.papel} para ${papel}.`);
  if (existente && !existente.ativo) console.log(`⚠️  A conta ${login} estava desativada e foi reativada.`);
  console.log(`✅ Usuário ${usuario.usuario || usuario.email} (${papel}) pronto.`);
  if (senhaGerada) console.log(`🔑 Senha gerada (anote agora, ela não será mostrada de novo): ${senha}`);
}

main()
  .catch((error) => {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
