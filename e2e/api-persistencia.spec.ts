import { test, expect } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, diaFuturo, gerarCpfValido, postLogin } from './credenciais';

/**
 * Ida e volta no banco dos fluxos principais: o que a API responde como salvo precisa voltar na leitura seguinte.
 * Cobre criação de usuário (com login usando a senha provisória), cliente, folga (escala e bloqueio) e agendamento.
 */

const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

test.describe('API — persistência ponta a ponta', () => {
  test('usuário criado pela supervisão fica gravado e consegue entrar', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const nome = `Persistencia Usuario ${sufixo()}`;
    const email = `persist.${sufixo()}@teste.com`;
    const senha = `Provisoria!${sufixo()}9`;
    const criado = await request.post(`${apiBase()}/colaboradores`, {
      headers: admin,
      data: { nome, email, senha, papel: 'collaborator', especialidade: 'Massagem', diasTrabalho: '1,2,3,4,5' },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const { id } = await criado.json();
    try {
      const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email: string }>;
      expect(equipe.find((c) => c.id === id)?.email).toBe(email);
      // A senha foi gravada com hash e confere no login (a conta entra pedindo a troca da provisória)
      const login = await postLogin(request, { data: { email, senha }, headers: { 'X-Auth-Mode': 'token' } });
      expect(login.ok(), await login.text()).toBeTruthy();
      // E-mail repetido é recusado com 409, sem criar outra conta
      const repetido = await request.post(`${apiBase()}/colaboradores`, { headers: admin, data: { nome: `${nome} B`, email, senha } });
      // Se a regra regredir e criar a segunda conta, a limpeza também a apaga
      if (repetido.status() === 201) await request.delete(`${apiBase()}/colaboradores/${(await repetido.json()).id}`, { headers: admin });
      expect(repetido.status()).toBe(409);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('supervisor criado pelo admin com usuário de acesso e sem e-mail: entra pelo usuário', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const usuario = `sup.${sufixo()}`;
    const senha = `Provisoria!${sufixo()}9`;
    // Sem usuário e sem e-mail não há como entrar: recusado
    const semLogin = await request.post(`${apiBase()}/colaboradores`, { headers: admin, data: { nome: `Sem Login ${sufixo()}`, senha, papel: 'supervisor' } });
    expect(semLogin.status()).toBe(400);
    // Dois sem e-mail: o vazio vira null (o índice único não colide em '')
    const criados: string[] = [];
    try {
      for (const u of [usuario, `${usuario}.b`]) {
        const res = await request.post(`${apiBase()}/colaboradores`, { headers: admin, data: { nome: `Supervisor ${u}`, usuario: u, email: '', senha, papel: 'supervisor' } });
        expect(res.status(), await res.text()).toBe(201);
        criados.push((await res.json()).id);
      }
      const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; papel: string; email: string | null }>;
      expect(equipe.find((c) => c.id === criados[0])).toMatchObject({ papel: 'supervisor', email: null });
      const login = await postLogin(request, { data: { email: usuario, senha }, headers: { 'X-Auth-Mode': 'token' } });
      expect(login.ok(), await login.text()).toBeTruthy();
      // Usuário repetido (mesmo com maiúsculas) é recusado com 409
      const repetido = await request.post(`${apiBase()}/colaboradores`, { headers: admin, data: { nome: `Repetido ${sufixo()}`, usuario: usuario.toUpperCase(), senha } });
      if (repetido.status() === 201) criados.push((await repetido.json()).id);
      expect(repetido.status()).toBe(409);
    } finally {
      for (const id of criados) await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('cliente, folga e agendamento gravam e voltam na leitura', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = equipe.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: admin })).json()) as Array<{ nome: string }>;
    const servico = servicos.find((s) => s.nome === 'E2E Massagem')?.nome;
    test.skip(!servico, 'Serviço E2E Massagem não encontrado (rode o seed:ci).');

    // Agendamento com cliente novo: cria o cliente junto
    const data = diaFuturo(40 + Math.floor(Math.random() * 30));
    const clientName = `Persistencia Cliente ${sufixo()}`;
    const ag = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin,
      data: { collaboratorId: helena!.id, date: data, time: '10:00', serviceNames: [servico], clientName },
    });
    expect(ag.status(), await ag.text()).toBe(201);
    const agendamento = await ag.json();
    let bloqueioId: string | undefined;
    try {
      const doCliente = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${agendamento.clienteId}`, { headers: admin })).json()) as Array<{ id: string }>;
      expect(doCliente.map((a) => a.id)).toContain(agendamento.id);

      // Edição do cliente
      const cpf = gerarCpfValido();
      const editado = await request.put(`${apiBase()}/clientes/${agendamento.clienteId}`, { headers: admin, data: { cpf, telefone: '11987654321' } });
      expect(editado.status(), await editado.text()).toBe(200);
      const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers: admin })).json()) as Array<{ id: string; cpf: string | null; telefone: string | null }>;
      const cliente = clientes.find((c) => c.id === agendamento.clienteId);
      expect(cliente?.cpf).toBe(cpf);
      expect(cliente?.telefone).toContain('987654321');

      // Folga na escala (dia seguinte ao agendamento, sem conflito)
      // Outros testes em paralelo marcam atendimentos para a Helena, e dia com atendimento não vira folga (409):
      // procura um dia livre depois do agendamento
      let diaFolga = data;
      let folga;
      for (let i = 1; i <= 10; i += 1) {
        diaFolga = new Date(new Date(`${data}T12:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10);
        folga = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: helena!.id, data: diaFolga, tipo: 'folga' } });
        if (folga.status() !== 409) break;
      }
      expect(folga!.status(), await folga!.text()).toBe(200);
      const escala = (await (await request.get(`${apiBase()}/escala/overrides?colaboradorId=${helena!.id}&month=${diaFolga.slice(0, 7)}`, { headers: admin })).json()) as Array<{ data: string; tipo: string }>;
      expect(escala.find((d) => d.data === diaFolga)?.tipo).toBe('folga');
      // Volta o dia a trabalho para não deixar resíduo
      await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: helena!.id, data: diaFolga, tipo: 'trabalho' } });

      // Bloqueio de agenda (afastamento de algumas horas)
      const bloqueio = await request.post(`${apiBase()}/bloqueios`, {
        headers: admin, data: { colaboradorId: helena!.id, data: diaFolga, horaInicio: '14:00', horaFim: '15:00', motivo: 'Teste de persistência' },
      });
      expect(bloqueio.status(), await bloqueio.text()).toBe(201);
      bloqueioId = (await bloqueio.json()).id;
      const bloqueios = (await (await request.get(`${apiBase()}/bloqueios`, { headers: admin })).json()) as Array<{ id: string }>;
      expect(bloqueios.map((b) => b.id)).toContain(bloqueioId);
    } finally {
      if (bloqueioId) await request.delete(`${apiBase()}/bloqueios/${bloqueioId}`, { headers: admin });
      await request.delete(`${apiBase()}/agendamentos/${agendamento.id}`, { headers: admin, data: { version: agendamento.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${agendamento.clienteId}`, { headers: admin });
    }
  });
});
