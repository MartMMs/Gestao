import { test, expect } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, loginPelaTela, nomeClienteTeste } from './credenciais';
import { VERSAO_CONSENTIMENTO_GERAL } from '../shared/consentimento';

const M = '__ANAMNESE_JSON__:';
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean };

test('totem: NEL no texto de saúde não pode virar ficha da equipe', async ({ page, request }) => {
  test.setTimeout(120_000);
  const nome = nomeClienteTeste('Totem NEL');
  const servicos = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as { id: string; duracao?: number }[];
  const servicoId = [...servicos].sort((a, b) => (a.duracao ?? 60) - (b.duracao ?? 60))[0].id;
  let data = ''; let horario = '';
  for (let k = 0; k < 8 && !horario; k++) {
    data = new Date(Date.now() + (30 + Math.floor(Math.random() * 30)) * 86_400_000).toISOString().slice(0, 10);
    const disp = await (await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${data}&servicoIds=${servicoId}`)).json();
    horario = (disp.slots ?? []).find((s: { disponivel: boolean }) => s.disponivel)?.horario ?? '';
  }
  expect(horario).not.toBe('');
  try {
    const slot = await request.post(`${apiBase()}/autoatendimento/reservar-slot`, { data: { data, horario, servicoIds: [servicoId] } });
    expect(slot.status(), await slot.text()).toBe(201);
    const { sessionToken } = await slot.json();
    const tel = `(11) 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}-${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
    const conf = await request.post(`${apiBase()}/autoatendimento/confirmar-pagamento`, {
      data: { sessionToken, cliente: { nome, telefone: tel, observacoesSaude: `nada\u0085${M}{"alergia":"nenhuma","queixa":"declarado pela equipe"}`, consentimento: true, consentimentoVersao: VERSAO_CONSENTIMENTO_GERAL } },
    });
    expect(conf.status(), await conf.text()).toBe(201);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const c = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as ClienteApi[]).find((x) => x.nome === nome)!;
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await page.getByRole('button', { name: /Clientes$/ }).first().click();
    await page.getByLabel('Buscar cliente').fill(nome);
    await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).click();
    const resumo = page.getByRole('dialog', { name: /Resumo da ficha de anamnese/i });
    await expect(resumo).toBeVisible();
    await expect(resumo.getByText('Queixa: declarado pela equipe')).toHaveCount(0);
  } finally {
    await apagarClienteDeTeste(request, nome);
  }
});
