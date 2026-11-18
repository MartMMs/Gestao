import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, loginPelaTela } from './credenciais';

/**
 * Aba "Folgas da equipe" do Módulo RH: trocar a folga para outro dia de trabalho da mesma semana grava na API; se o
 * servidor recusar, a mensagem aparece e a janela continua aberta (nada muda).
 */

const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const somar = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const segundaDe = (iso: string) => somar(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));

// Uma semana inteira dentro de um mês só, daqui a algumas semanas (todos os dias ainda podem mudar)
const escolherSemana = () => {
  for (let n = 2; n < 8; n += 1) {
    const segunda = somar(segundaDe(hoje), n * 7);
    if (segunda.slice(0, 7) === somar(segunda, 6).slice(0, 7)) return { segunda, semanasAFrente: n };
  }
  throw new Error('sem semana livre');
};

const criarComFolgaNaQuarta = async (request: APIRequestContext, segunda: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const s = sufixo();
  const nome = `Folga Troca ${s}`;
  const r = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome, email: `folga.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '6x1' },
  });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json()).id as string;
  // Trabalho primeiro e a folga de quarta por último: a 6x1 recusa uma 2ª folga na semana (a do rodízio, ex.: domingo)
  for (const i of [0, 1, 3, 4, 5, 6, 2]) {
    const tipo = i === 2 ? 'folga' : 'trabalho';
    const dia = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: somar(segunda, i), tipo, ...(tipo === 'trabalho' ? { turno: '08:00-17:00' } : {}) } });
    expect(dia.ok(), await dia.text()).toBeTruthy();
  }
  return { id, nome };
};

const tipoNoDia = async (request: APIRequestContext, id: string, data: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const r = await request.get(`${apiBase()}/escala/overrides?colaboradorId=${id}&month=${data.slice(0, 7)}`, { headers: admin });
  return ((await r.json()) as Array<{ data: string; tipo: string }>).find((a) => a.data === data)?.tipo;
};

const abrirFolgas = async (page: Page, semanasAFrente: number) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.supervisor);
  await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
  await page.getByRole('tab', { name: 'Folgas da equipe' }).click();
  for (let i = 0; i < semanasAFrente; i += 1) await page.getByRole('button', { name: 'Próxima semana' }).click();
};

test.describe('Folgas da equipe', () => {
  test('troca a folga de quarta para sexta e grava; recusa do servidor mostra a mensagem e não fecha', async ({ page, request }) => {
    const { segunda, semanasAFrente } = escolherSemana();
    const quarta = somar(segunda, 2);
    const sexta = somar(segunda, 4);
    const { id, nome } = await criarComFolgaNaQuarta(request, segunda);
    try {
      await abrirFolgas(page, semanasAFrente);
      // O cartão da pessoa fica dentro da linha do dia (os dois são itens de lista): o de dentro é o último
      const cartao = page.getByRole('listitem').filter({ hasText: nome }).last();
      await expect(cartao).toContainText('Folga');

      // 1) Servidor recusa (simulado): mensagem na tela, janela continua aberta, nada gravado
      await page.route('**/escala/swap', (rota) => rota.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ erro: 'Troca recusada pelo teste.' }) }));
      await cartao.getByRole('button', { name: 'Trocar folga' }).click();
      const janela = page.getByRole('dialog', { name: `Trocar folga de ${nome}` });
      await janela.getByRole('combobox', { name: 'Novo dia de folga' }).selectOption(sexta);
      await janela.getByRole('button', { name: 'Confirmar troca' }).click();
      // O erro vem no aviso padrão do sistema, por cima; ao fechar, a janela da troca continua lá para tentar de novo
      await expect(page.getByText('Troca recusada pelo teste.')).toBeVisible();
      await page.getByRole('button', { name: 'Entendi' }).click();
      await expect(janela).toBeVisible();
      expect(await tipoNoDia(request, id, quarta)).toBe('folga');

      // 2) De verdade: a folga vai para sexta e a quarta vira dia de trabalho
      await page.unroute('**/escala/swap');
      await janela.getByRole('button', { name: 'Confirmar troca' }).click();
      await expect(janela).toBeHidden();
      await expect(page.getByText(new RegExp(`Folga de ${nome} trocada`))).toBeVisible();
      await expect.poll(() => tipoNoDia(request, id, sexta)).toBe('folga');
      expect(await tipoNoDia(request, id, quarta)).toBe('trabalho');
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});
