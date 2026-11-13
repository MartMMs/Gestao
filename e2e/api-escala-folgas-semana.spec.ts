import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiBase, authHeaders, CONTAS } from './credenciais';
import { ehFeriado } from '../shared/feriadosBR';

/**
 * Regra do 6x1 no servidor: uma folga comum por semana (segunda a domingo), conferida depois de todas as gravações de
 * cada operação (marcar, trocar, replicar). Só recusa quando a operação ACRESCENTA folga a uma semana acima do limite.
 * 5x2 aceita as duas folgas em quaisquer dias.
 */
const sufixo = () => Math.random().toString(36).slice(2, 8);
const somarDias = (data: string, dias: number) => new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
// Segunda-feira de uma semana futura (a API recusa o passado) sem feriado nacional: feriado não conta como folga
const semFeriado = (seg: string) => [0, 1, 2, 3, 4, 5, 6].every((i) => !ehFeriado(somarDias(seg, i)));
const segundaFutura = (semanas = 5) => {
  const d = new Date(Date.now() + semanas * 7 * 86_400_000);
  d.setUTCHours(12);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  let seg = d.toISOString().slice(0, 10);
  while (!semFeriado(seg)) seg = somarDias(seg, 7);
  return seg;
};

type Ctx = { admin: Record<string, string>; ids: string[] };
const criar = async (request: APIRequestContext, ctx: Ctx, tipoEscala: string) => {
  const s = sufixo();
  const r = await request.post(`${apiBase()}/colaboradores`, {
    headers: ctx.admin, data: { nome: `Folga Semana ${s}`, email: `folgasemana.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala },
  });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json()).id as string;
  ctx.ids.push(id);
  return id;
};
const gravar = (request: APIRequestContext, ctx: Ctx, colaboradorId: string, data: string, tipo: string, turno?: string) =>
  request.post(`${apiBase()}/escala/override`, { headers: ctx.admin, data: { colaboradorId, data, tipo, ...(tipo === 'trabalho' ? { turno: turno ?? '08:00-17:00' } : {}) } });

test.describe('API — escala: folgas por semana', () => {
  const ctx: Ctx = { admin: {}, ids: [] };
  test.beforeAll(async ({ request }) => { ctx.admin = await authHeaders(request, CONTAS.admin); });
  test.afterAll(async ({ request }) => {
    // Excluir quem nunca atendeu apaga também os dias de escala
    for (const id of ctx.ids) await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: ctx.admin });
  });

  test('6x1: troca no mesmo profissional dentro da semana é aceita; replicar folga para a mesma semana é recusado', async ({ request }) => {
    const id = await criar(request, ctx, '6x1');
    const seg = segundaFutura();
    const domingo = somarDias(seg, 6);
    // Domingo (folga do contrato) troca com a terça: continua uma folga na semana
    const troca = await request.post(`${apiBase()}/escala/swap`, {
      headers: ctx.admin, data: { from: { colaboradorId: id, data: domingo, snapshot: { tipo: 'fds' } }, to: { colaboradorId: id, data: somarDias(seg, 1), snapshot: { tipo: 'trabalho' } } },
    });
    expect(troca.status(), await troca.text()).toBe(200);
    const replicar = await request.post(`${apiBase()}/escala/replicate`, {
      headers: ctx.admin, data: { colaboradorId: id, data: somarDias(seg, 1), targetDates: [somarDias(seg, 3)] },
    });
    expect(replicar.status(), await replicar.text()).toBe(409);
  });

  test('6x1: troca entre profissionais que leva uma 2ª folga para a semana é recusada', async ({ request }) => {
    const a = await criar(request, ctx, '6x1');
    const b = await criar(request, ctx, '6x1');
    const seg = segundaFutura(6);
    // A segunda-feira de B vira folga só depois de o domingo dele virar trabalho
    expect((await gravar(request, ctx, b, somarDias(seg, 6), 'trabalho')).ok()).toBeTruthy();
    expect((await gravar(request, ctx, b, seg, 'folga')).ok()).toBeTruthy();
    // A folga de B (segunda) iria para a quarta de A, que já tem o domingo de folga
    const troca = await request.post(`${apiBase()}/escala/swap`, {
      headers: ctx.admin, data: { from: { colaboradorId: b, data: seg }, to: { colaboradorId: a, data: somarDias(seg, 2), snapshot: { tipo: 'trabalho' } } },
    });
    expect(troca.status(), await troca.text()).toBe(409);
  });

  test('6x1: semana que já tinha folga a mais continua editável e pode ser corrigida', async ({ request }) => {
    // Duas folgas gravadas como 5x2 e o contrato mudado para 6x1 depois: a semana fica com 3 (seg, ter e o domingo)
    const id = await criar(request, ctx, '5x2');
    const seg = segundaFutura(7);
    expect((await gravar(request, ctx, id, seg, 'folga')).ok()).toBeTruthy();
    expect((await gravar(request, ctx, id, somarDias(seg, 1), 'folga')).ok()).toBeTruthy();
    expect((await request.put(`${apiBase()}/colaboradores/${id}`, { headers: ctx.admin, data: { tipoEscala: '6x1' } })).ok()).toBeTruthy();

    // Mudar só o turno de um dia de trabalho não mexe nas folgas
    const turno = await gravar(request, ctx, id, somarDias(seg, 2), 'trabalho', '10:00-19:00');
    expect(turno.status(), await turno.text()).toBe(200);
    // Atestado não é folga comum
    const atestado = await request.post(`${apiBase()}/escala/override`, { headers: ctx.admin, data: { colaboradorId: id, data: somarDias(seg, 3), tipo: 'folga', descricao: 'Atestado médico' } });
    expect(atestado.status(), await atestado.text()).toBe(200);
    // Mais uma folga comum é recusada
    expect((await gravar(request, ctx, id, somarDias(seg, 4), 'folga')).status()).toBe(409);
    // Corrigir aos poucos: cada folga que vira trabalho é aceita, mesmo a semana ainda acima do limite
    expect((await gravar(request, ctx, id, seg, 'trabalho')).status()).toBe(200);
    expect((await gravar(request, ctx, id, somarDias(seg, 1), 'trabalho')).status()).toBe(200);
  });

  test('6x1: semana que atravessa a virada do mês conta as folgas dos dois meses', async ({ request }) => {
    const id = await criar(request, ctx, '6x1');
    // Primeira segunda-feira cujo domingo cai no mês seguinte
    let seg = segundaFutura(5);
    while (somarDias(seg, 6).slice(5, 7) === seg.slice(5, 7) || !semFeriado(seg)) seg = somarDias(seg, 7);
    const ultimoDoMes = [0, 1, 2, 3, 4, 5].map((i) => somarDias(seg, i)).filter((d) => d.slice(5, 7) === seg.slice(5, 7)).pop()!;
    // O domingo (já no outro mês) é a folga do contrato: uma folga no último dia do mês é a 2ª da mesma semana
    const r = await gravar(request, ctx, id, ultimoDoMes, 'folga');
    expect(r.status(), await r.text()).toBe(409);
  });

  test('5x2: duas folgas em quaisquer dias da semana', async ({ request }) => {
    const id = await criar(request, ctx, '5x2');
    const seg = segundaFutura(8);
    // Sábado e domingo voltam a ser trabalho; as folgas vão para terça e quinta
    expect((await gravar(request, ctx, id, somarDias(seg, 5), 'trabalho')).ok()).toBeTruthy();
    expect((await gravar(request, ctx, id, somarDias(seg, 6), 'trabalho')).ok()).toBeTruthy();
    expect((await gravar(request, ctx, id, somarDias(seg, 1), 'folga')).status()).toBe(200);
    expect((await gravar(request, ctx, id, somarDias(seg, 3), 'folga')).status()).toBe(200);
  });
});
