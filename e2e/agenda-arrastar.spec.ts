import { test, expect } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, loginPelaTela, postLogin } from './credenciais';

const ALTURA_HORA = 80; // SCHEDULE_CONFIG.HOUR_HEIGHT

const horaNoNegocio = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).split(':').map(Number);
  return h * 60 + m;
};
const hojeNoNegocio = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

test.describe('UI — arrastar para remarcar', () => {
  test('soltar o card abre a confirmação; "Manter horário" não grava; "Remarcar" grava o novo horário', async ({ page, request }) => {
    // Atendimento de hoje, pelo menos 1 h à frente, com espaço para andar 2 h antes do fechamento (21h)
    const inicio = Math.ceil((horaNoNegocio() + 60) / 30) * 30;
    test.skip(inicio > 17 * 60, 'Tarde demais para marcar e arrastar um atendimento hoje.');

    const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
    const auth = { Authorization: `Bearer ${(await login.json()).token}` };
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: auth })).json()) as Array<{ id: string; email?: string | null }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');

    const cliente = `Banca Arrastar ${Date.now().toString(36)}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
    let id: string | undefined;
    let horario = '';
    for (let tentativa = 0; tentativa < 6 && !id; tentativa += 1) {
      horario = hhmm(inicio + tentativa * 30);
      const res = await request.post(`${apiBase()}/agendamentos`, {
        headers: auth,
        data: { collaboratorId: helena!.id, date: `${hojeNoNegocio()}T${horario}:00.000-03:00`, serviceNames: ['E2E Massagem'], clientName: cliente, contact: '(11) 97777-5544' },
      });
      if (res.status() === 201) id = (await res.json()).id;
    }
    test.skip(!id, 'Nenhum horário livre hoje para a colaboradora de teste.');

    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /^Agenda$/i }).click();
      const card = page.locator('[draggable="true"]').filter({ hasText: cliente });
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      const coluna = card.locator('xpath=..');

      const arrastarDuasHoras = async () => {
        const caixaCard = (await card.boundingBox())!;
        const caixaColuna = (await coluna.boundingBox())!;
        const topo = caixaCard.y - caixaColuna.y;
        await card.dragTo(coluna, { targetPosition: { x: caixaCard.width / 2, y: topo + 2 * ALTURA_HORA + caixaCard.height / 2 } });
      };
      const novoHorario = hhmm(Number(horario.slice(0, 2)) * 60 + Number(horario.slice(3)) + 120);
      const dialogo = page.getByRole('dialog', { name: /Remarcar atendimento/i });

      // Desistir: nada é gravado
      await arrastarDuasHoras();
      await expect(dialogo).toBeVisible();
      await expect(dialogo).toContainText(`para ${novoHorario}`);
      await dialogo.getByRole('button', { name: 'Manter horário' }).click();
      await expect(dialogo).toBeHidden();
      const depoisDeDesistir = (await (await request.get(`${apiBase()}/agendamentos`, { headers: auth })).json()) as Array<{ id: string; data: string }>;
      expect(new Date(depoisDeDesistir.find((a) => a.id === id)!.data).getTime()).toBe(new Date(`${hojeNoNegocio()}T${horario}:00-03:00`).getTime());

      // Confirmar: grava o novo horário e avisa
      await arrastarDuasHoras();
      await dialogo.getByRole('button', { name: 'Remarcar' }).click();
      await expect(page.getByText(`Agendamento remarcado para ${novoHorario}.`)).toBeVisible();
      const depoisDeRemarcar = (await (await request.get(`${apiBase()}/agendamentos`, { headers: auth })).json()) as Array<{ id: string; data: string }>;
      expect(new Date(depoisDeRemarcar.find((a) => a.id === id)!.data).getTime()).toBe(new Date(`${hojeNoNegocio()}T${novoHorario}:00-03:00`).getTime());
    } finally {
      if (id) await request.delete(`${apiBase()}/agendamentos/${id}`, { headers: auth });
    }
  });
});
