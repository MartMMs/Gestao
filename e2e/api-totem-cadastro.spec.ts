import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';
import { VERSAO_CONSENTIMENTO_GERAL } from '../shared/consentimento';

/**
 * Cadastro do cliente pelo totem: nada é recusado (a recusa revelaria se o nome ou o CPF já são de alguém). Quem não
 * confere com um cadastro existente ganha um cadastro à parte, "Nome (tel. final NN)", para a recepção unificar.
 */
const urlBanco = process.env.E2E_DATABASE_URL;
const letras = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const fone = () => `(11) 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}-${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;

test.describe.serial('API — totem: cadastro do cliente', () => {
  test.skip(!urlBanco, 'Defina E2E_DATABASE_URL (o banco que a API de testes usa) para rodar estes testes.');
  const prisma = new PrismaClient({ datasourceUrl: urlBanco });
  const agendamentos: string[] = [];
  const clientes = new Set<string>();
  let servicoId = '';
  let data = '';
  let horarios: string[] = [];

  test.beforeAll(async ({ request }) => {
    const servicos = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as { id: string; duracao?: number }[];
    servicoId = [...servicos].sort((a, b) => (a.duracao ?? 60) - (b.duracao ?? 60))[0].id;
    // Dia sorteado longe dos outros testes do totem
    for (let tentativa = 0; tentativa < 6 && horarios.length < 11; tentativa++) {
      data = new Date(Date.now() + (20 + Math.floor(Math.random() * 35)) * 86_400_000).toISOString().slice(0, 10);
      const disp = await (await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${data}&servicoIds=${servicoId}`)).json();
      horarios = (disp.slots ?? []).filter((s: { disponivel: boolean }) => s.disponivel).map((s: { horario: string }) => s.horario);
    }
    expect(horarios.length, 'dia com 11 horários livres').toBeGreaterThanOrEqual(11);
  });

  test.afterAll(async ({ request }) => {
    const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
    const headers = { Authorization: `Bearer ${(await login.json()).token}` };
    for (const id of agendamentos) await request.delete(`${apiBase()}/agendamentos/${id}`, { headers });
    for (const id of clientes) await request.delete(`${apiBase()}/clientes/${id}`, { headers });
    await prisma.$disconnect();
  });

  const reservar = async (request: APIRequestContext, cliente: { nome: string; telefone: string; cpf?: string }) => {
    const horario = horarios.shift()!;
    const slot = await request.post(`${apiBase()}/autoatendimento/reservar-slot`, { data: { data, horario, servicoIds: [servicoId] } });
    expect(slot.status(), await slot.text()).toBe(201);
    const { sessionToken } = await slot.json();
    const conf = await request.post(`${apiBase()}/autoatendimento/confirmar-pagamento`, {
      data: { sessionToken, cliente: { observacoesSaude: '', consentimento: true, consentimentoVersao: VERSAO_CONSENTIMENTO_GERAL, ...cliente } },
    });
    expect(conf.status(), await conf.text()).toBe(201);
    const { agendamentoId } = await conf.json();
    agendamentos.push(agendamentoId);
    const ag = await prisma.agendamento.findUniqueOrThrow({ where: { id: agendamentoId }, include: { cliente: true } });
    clientes.add(ag.clienteId);
    return ag.cliente;
  };

  test('homônimo com outro telefone ganha cadastro à parte (2 dígitos do telefone) e a volta reaproveita os dois', async ({ request }) => {
    const nome = `Banca Homonimo ${letras()}`;
    const t1 = fone();
    const t2 = fone();
    const original = await reservar(request, { nome, telefone: t1 });
    expect(original.nome).toBe(nome);
    const aParte = await reservar(request, { nome, telefone: t2 });
    expect(aParte.id).not.toBe(original.id);
    expect(aParte.nome).toBe(`${nome} (tel. final ${t2.slice(-2)})`);
    expect((await reservar(request, { nome: ` ${nome.toUpperCase()} `, telefone: t2.replace(/\D/g, '') })).id).toBe(aParte.id);
    expect((await reservar(request, { nome, telefone: t1 })).id).toBe(original.id);
    // Terceiro homônimo com o mesmo final de telefone: ganha " 2" e também é reconhecido na volta
    const t3 = `(21) 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}-${String(Math.floor(Math.random() * 100)).padStart(2, '0')}${t2.slice(-2)}`;
    const terceiro = await reservar(request, { nome, telefone: t3 });
    expect(terceiro.nome).toBe(`${nome} (tel. final ${t2.slice(-2)}) 2`);
    expect((await reservar(request, { nome, telefone: t3 })).id).toBe(terceiro.id);
  });

  test('CPF diferente do cadastrado não cai no cadastro de outra pessoa; o mesmo CPF volta para o seu', async ({ request }) => {
    const nome = `Banca Cpf ${letras()}`;
    const telefone = fone();
    const dona = await reservar(request, { nome, telefone, cpf: '529.982.247-25' });
    const outra = await reservar(request, { nome, telefone, cpf: '111.444.777-35' });
    expect(outra.id).not.toBe(dona.id);
    expect(outra.cpf).toBe('11144477735');
    expect((await reservar(request, { nome, telefone, cpf: '111.444.777-35' })).id).toBe(outra.id);
    expect((await reservar(request, { nome, telefone, cpf: '529.982.247-25' })).id).toBe(dona.id);
    // Sem CPF, com os dois cadastros no mesmo telefone: fica no original (nome sem sufixo)
    expect((await reservar(request, { nome, telefone })).id).toBe(dona.id);
  });
});
