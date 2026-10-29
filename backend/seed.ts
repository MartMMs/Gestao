import { config } from './env';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { validarSenha } from './lib/usuarios';

async function main() {
  // O seed APAGA todos os dados: nunca roda em produção
  if (config.producao) throw new Error('O seed de demonstração apaga o banco e não pode rodar com NODE_ENV=production.');

  // Senha comum dos profissionais de demonstração, definida no .env (nunca fixa no código)
  const senhaDemo = process.env.SEED_PASSWORD;
  const erroSenha = validarSenha(senhaDemo);
  if (erroSenha) throw new Error(`SEED_PASSWORD: ${erroSenha}`);
  const senha = await bcrypt.hash(senhaDemo!, 10);

  // Contas privilegiadas ganham senhas próprias e aleatórias, mostradas uma vez no fim
  const senhaAdmin = crypto.randomBytes(12).toString('base64url');
  const senhaSupervisor = crypto.randomBytes(12).toString('base64url');

  console.log('🧹 Limpando dados antigos do banco...');
  // Deletar na ordem inversa das dependências para evitar erros de chave estrangeira
  await prisma.agendamento.deleteMany();
  await prisma.bloqueio.deleteMany();
  await prisma.escalaOverride.deleteMany();
  await prisma.solicitacaoTroca.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.servico.deleteMany();
  await prisma.colaborador.deleteMany();

  console.log('🌱 Semeando o banco de dados...');

  await prisma.colaborador.create({
    data: { nome: 'Administrador', email: 'admin@serenidade.com', especialidade: 'Gestão', papel: 'admin', ativo: true, senha: await bcrypt.hash(senhaAdmin, 10) },
  });
  await prisma.colaborador.create({
    data: { nome: 'Supervisor Operacional', email: 'supervisor@serenidade.com', especialidade: 'Coordenação', papel: 'supervisor', ativo: true, senha: await bcrypt.hash(senhaSupervisor, 10) },
  });

  const helena = await prisma.colaborador.create({
    data: {
      nome: 'Helena Silva',
      email: 'helena@serenidade.com',
      especialidade: 'Massoterapia',
      ativo: true,
      papel: 'collaborator',
      senha,
    },
  });

  const marcos = await prisma.colaborador.create({
    data: {
      nome: 'Marcos Oliveira',
      email: 'marcos@serenidade.com',
      especialidade: 'Estética',
      ativo: true,
      papel: 'collaborator',
      senha,
    },
  });

  const ana = await prisma.colaborador.create({
    data: {
      nome: 'Ana Luiza',
      email: 'ana@serenidade.com',
      especialidade: 'Yoga & Meditação',
      ativo: true,
      papel: 'collaborator',
      senha,
    },
  });

  const roberto = await prisma.colaborador.create({
    data: {
      nome: 'Roberto Santos',
      email: 'roberto@serenidade.com',
      especialidade: 'Recepção',
      ativo: true,
      papel: 'receptionist',
      senha,
    },
  });

  console.log('💆 Semeando serviços...');
  const servicos = [
    { nome: 'Massagem Relaxante', preco: 150.0 },
    { nome: 'Massagem Terapêutica', preco: 180.0 },
    { nome: 'Limpeza de Pele', preco: 120.0 },
    { nome: 'Drenagem Linfática', preco: 140.0 },
    { nome: 'Sessão de Yoga', preco: 80.0 },
    { nome: 'Aromaterapia', preco: 90.0 }
  ];

  for (const servico of servicos) {
    await prisma.servico.create({ data: servico });
  }
  
  console.log('👥 Semeando clientes...');
  const clientes = [
    { nome: 'Juliana Costa', telefone: '11999998888' },
    { nome: 'Carlos Mendes', telefone: '11988887777' },
    { nome: 'Fernanda Lima', telefone: '11977776666' }
  ];

  const clientesCriados = [];
  for (const cliente of clientes) {
    const c = await prisma.cliente.create({ data: cliente });
    clientesCriados.push(c);
  }

  console.log('📅 Semeando agendamentos para hoje...');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  
  // Função para criar datas facilmente no dia de hoje
  const criarData = (horas: number, minutos: number) => {
    const data = new Date(hoje);
    data.setHours(horas, minutos, 0, 0);
    return data;
  };

  const todosServicos = await prisma.servico.findMany();

  // Agendamento 1
  await prisma.agendamento.create({
    data: {
      data: criarData(10, 0),
      status: 'scheduled',
      colaboradorId: helena.id,
      clienteId: clientesCriados[0].id,
      servicos: { connect: [{ id: todosServicos[0].id }] }
    }
  });

  // Agendamento 2
  await prisma.agendamento.create({
    data: {
      data: criarData(14, 30),
      status: 'scheduled',
      colaboradorId: marcos.id,
      clienteId: clientesCriados[1].id,
      servicos: { connect: [{ id: todosServicos[2].id }, { id: todosServicos[3].id }] }
    }
  });

  console.log('✅ Banco populado com sucesso!');
  console.log('Profissionais criados:', { helena: helena.nome, marcos: marcos.nome, ana: ana.nome, roberto: roberto.nome });
  console.log('🔑 Senhas das contas de gestão (anote agora, não serão mostradas de novo):');
  console.log(`   admin@serenidade.com: ${senhaAdmin}`);
  console.log(`   supervisor@serenidade.com: ${senhaSupervisor}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });