import { test, expect } from '@playwright/test';
import { CONTAS, apiBase, authHeaders, diaFuturo } from './credenciais';

/**
 * Agenda da casa na recepção: a tela troca "excluir" por "cancelar" e deixa realocar. O que vale é o servidor:
 * a recepção não exclui (403), o destino da realocação é validado (400) e a troca de profissional fica na auditoria.
 */

type Agendamento = { id: string; clienteId: string; atualizadoEm: string; status: string; assignedEmployeeId?: string; colaboradorId?: string };
const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

test('recepção: não exclui (403), destino inválido é recusado (400), realoca com auditoria e cancela mantendo o histórico', async ({ request }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const recepcao = await authHeaders(request, CONTAS.recepcao);
  const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email: string }>;
  const helena = equipe.find((c) => c.email === CONTAS.colaboradora)!.id;

  // Destino próprio do teste, com o dia marcado como trabalho: a realocação não depende do rodízio da equipe do seed
  const s = sufixo();
  const destino = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome: `Destino Recepcao ${s}`, email: `destino.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '5x2' },
  });
  expect(destino.status(), await destino.text()).toBe(201);
  const destinoId = (await destino.json()).id as string;

  let ag: Agendamento | null = null;
  try {
    for (let tentativa = 0; tentativa < 8 && !ag; tentativa += 1) {
      const data = diaFuturo(30 + Math.floor(Math.random() * 30));
      const criado = await request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: helena, date: data, time: '10:00', serviceNames: ['E2E Massagem'], clientName: `Recepcao Agenda ${s}` },
      });
      if (criado.status() !== 201) continue; // dia de folga da Helena ou horário ocupado: sorteia outro
      ag = (await criado.json()) as Agendamento;
      const trabalho = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: destinoId, data, tipo: 'trabalho', turno: '08:00-18:00' } });
      expect(trabalho.ok(), await trabalho.text()).toBeTruthy();
    }
    expect(ag, 'atendimento de teste marcado').not.toBeNull();
    const atendimento = ag!;

    // Excluir é só da supervisão: a tela da recepção cancela
    expect((await request.delete(`${apiBase()}/agendamentos/${atendimento.id}`, { headers: recepcao, data: { version: atendimento.atualizadoEm } })).status()).toBe(403);

    const invalido = await request.patch(`${apiBase()}/agendamentos/${atendimento.id}/reassign`, { headers: recepcao, data: { newEmployeeId: 'nao-e-um-id', version: atendimento.atualizadoEm } });
    expect(invalido.status()).toBe(400);

    const realocado = await request.patch(`${apiBase()}/agendamentos/${atendimento.id}/reassign`, { headers: recepcao, data: { newEmployeeId: destinoId, version: atendimento.atualizadoEm } });
    expect(realocado.ok(), await realocado.text()).toBeTruthy();
    const depois = (await realocado.json()) as Agendamento;
    expect(depois.assignedEmployeeId ?? depois.colaboradorId).toBe(destinoId);
    const auditoria = (await (await request.get(`${apiBase()}/auditoria`, { headers: admin })).json()) as Array<{ acao: string; alvo: string }>;
    expect(auditoria.some((r) => r.acao === 'agendamento.realocado'), 'troca de profissional fica na auditoria').toBeTruthy();

    const cancelado = await request.patch(`${apiBase()}/agendamentos/${atendimento.id}/status`, { headers: recepcao, data: { status: 'cancelled', version: depois.atualizadoEm } });
    expect(cancelado.ok(), await cancelado.text()).toBeTruthy();
    expect(((await cancelado.json()) as Agendamento).status).toBe('cancelled');
    // Cancelar não apaga: o registro continua lá (a agenda só esconde os cancelados) e a supervisão ainda pode excluí-lo
    const exclusao = await request.delete(`${apiBase()}/agendamentos/${atendimento.id}`, { headers: admin, data: { version: ((await cancelado.json()) as Agendamento).atualizadoEm } });
    expect(exclusao.ok(), await exclusao.text()).toBeTruthy();
  } finally {
    if (ag) {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin });
      await request.delete(`${apiBase()}/clientes/${ag.clienteId}`, { headers: admin });
    }
    await request.delete(`${apiBase()}/colaboradores/${destinoId}`, { headers: admin });
  }
});
