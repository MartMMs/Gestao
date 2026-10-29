import { test, expect } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apagarClienteDeTeste, gerarCpfValido, loginPelaTela } from './credenciais';

const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';

type PerfilLogin = 'Colaborador' | 'Supervisor';

type LoginResult = {
  ok: boolean;
  token?: string;
  status: number;
  body: Record<string, unknown>;
};

type ApiAppointment = {
  id?: string;
  clientName?: string;
  date?: string;
  data?: string;
  cliente?: {
    nome?: string | null;
  } | null;
};

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getAppointmentClientName(appointment: ApiAppointment): string | undefined {
  if (typeof appointment.clientName === 'string') return appointment.clientName;
  if (typeof appointment.cliente?.nome === 'string') return appointment.cliente.nome;
  return undefined;
}

function getAppointmentDateOnly(appointment: ApiAppointment): string | undefined {
  const rawDate = typeof appointment.date === 'string'
    ? appointment.date
    : typeof appointment.data === 'string'
      ? appointment.data
      : undefined;

  if (!rawDate) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  if (rawDate.includes('T')) return rawDate.split('T')[0];

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return undefined;
  return parsedDate.toISOString().slice(0, 10);
}

async function gotoAppWithRetry(page: import('@playwright/test').Page): Promise<void> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await page.waitForTimeout(1_500);
    }
  }

  throw lastError;
}

async function loginComPerfil(
  page: import('@playwright/test').Page,
  role: PerfilLogin,
): Promise<void> {
  const targetHeading = role === 'Supervisor'
    ? page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })
    : page.getByRole('heading', { name: /Portal do Colaborador/i });

  await gotoAppWithRetry(page);
  await loginPelaTela(page, role === 'Supervisor' ? CONTAS.supervisor : CONTAS.colaboradora);
  await expect(targetHeading).toBeVisible({ timeout: 20_000 });
}

async function loginApi(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  senha: string,
): Promise<LoginResult> {
  const response = await request.post(`${apiBase()}/login`, { data: { email, senha } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: response.ok(),
    token: typeof body.token === 'string' ? body.token : undefined,
    status: response.status(),
    body,
  };
}

async function selectAnyService(modal: import('@playwright/test').Locator): Promise<void> {
  // Limpa servicos previamente selecionados (draft localStorage) para evitar duracoes inesperadas.
  const selectedButtons = modal.getByRole('button', { name: /Selecionado/i });
  const selectedCount = await selectedButtons.count();
  for (let index = 0; index < selectedCount; index++) {
    await selectedButtons.first().click();
  }

  const preferredPatterns = [
    /Aromaterapia/i,
    /Massagem Relaxante/i,
    /Drenagem Linf[aá]tica/i,
    /Sess[aã]o de Yoga/i,
    /E2E Massagem/i,
  ];

  for (const pattern of preferredPatterns) {
    const candidate = modal.getByRole('button', { name: pattern });
    if (await candidate.count()) {
      await candidate.first().click();
      return;
    }
  }

  const fallback = modal.getByRole('button', { name: /Toque para incluir/i }).first();
  await expect(fallback).toBeVisible();
  await fallback.click();
}

async function cleanupAppointmentsByClientName(
  request: import('@playwright/test').APIRequestContext,
  clientName: string,
): Promise<void> {
  const supervisor = await loginApi(request, CONTAS.admin, E2E_PASSWORD);
  if (!supervisor.ok || !supervisor.token) return;

  const listResponse = await request.get(`${apiBase()}/agendamentos`, {
    headers: { Authorization: `Bearer ${supervisor.token}` },
  });
  if (!listResponse.ok()) return;

  const appointments = (await listResponse.json().catch(() => [])) as ApiAppointment[];
  const created = appointments.filter((appointment) => getAppointmentClientName(appointment) === clientName && typeof appointment.id === 'string');

  for (const appointment of created) {
    await request.delete(`${apiBase()}/agendamentos/${appointment.id}`, {
      headers: { Authorization: `Bearer ${supervisor.token}` },
    });
  }
}

test.describe('User flow, system and final-user simulation', () => {
  test.describe.configure({ mode: 'serial' });

  test('User Flow Testing: colaborador cria agendamento completo pela interface', async ({ page, request }) => {
    const targetDate = futureDate(75);
    const uniqueSeed = String(Date.now());
    const uniqueClient = `E2E Fluxo ${uniqueSeed}`;
    const uniqueCpf = gerarCpfValido();
    const uniquePhone = `(11) 9${uniqueSeed.slice(-8, -4)}-${uniqueSeed.slice(-4)}`;

    try {
      await loginComPerfil(page, 'Colaborador');
      await expect(page.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();

      await page.locator('input[type="date"]').first().fill(targetDate);
      await page.getByRole('button', { name: /Agendar/i }).click();

      const modalHeading = page.getByRole('heading', { name: /Novo Agendamento/i });
      await expect(modalHeading).toBeVisible();

      const modal = modalHeading.locator('xpath=ancestor::div[contains(@class,"bg-surface-container-lowest")]').first();
      await modal.getByRole('button', { name: /Novo Cliente/i }).click();
      await modal.getByPlaceholder('Nome completo').fill(uniqueClient);
      await modal.getByPlaceholder('(00) 00000-0000').fill(uniquePhone);
      await modal.getByPlaceholder('000.000.000-00').fill(uniqueCpf);
      await modal.locator('input[type="date"]').first().fill(targetDate);
      await selectAnyService(modal);

      const slotCandidates = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
      let saved = false;

      for (const slot of slotCandidates) {
        const modalStillOpenBeforeFill = await modalHeading.isVisible().catch(() => false);
        if (!modalStillOpenBeforeFill) {
          saved = true;
          break;
        }

        const timeInput = modal.locator('input[type="time"]').first();
        await expect(timeInput).toBeVisible({ timeout: 5_000 });
        await timeInput.fill(slot);
        await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();

        const modalClosedAfterSubmit = await modalHeading.isHidden().catch(() => false);
        if (modalClosedAfterSubmit) {
          saved = true;
          break;
        }

        try {
          await expect(page.getByText(/Agendamento salvo na sua agenda/i)).toBeVisible({ timeout: 6_000 });
          saved = true;
          break;
        } catch {
          const dismissError = page.getByRole('button', { name: /Entendi/i });
          if (await dismissError.count()) {
            await dismissError.first().click();
          }
        }
      }

      expect(saved, 'Nao foi possivel encontrar horario disponivel para criar agendamento no fluxo E2E.').toBeTruthy();
      await expect(modalHeading).toBeHidden({ timeout: 12_000 });

      const supervisor = await loginApi(request, CONTAS.admin, E2E_PASSWORD);
      expect(supervisor.ok, `login supervisor falhou: ${JSON.stringify(supervisor.body)}`).toBeTruthy();
      expect(supervisor.token).toBeTruthy();

      const listResponse = await request.get(`${apiBase()}/agendamentos`, {
        headers: { Authorization: `Bearer ${supervisor.token}` },
      });
      expect(listResponse.ok()).toBeTruthy();

      const appointments = (await listResponse.json()) as ApiAppointment[];
      const created = appointments.find((appointment) => {
        const clientName = getAppointmentClientName(appointment);
        const appointmentDate = getAppointmentDateOnly(appointment);
        return clientName === uniqueClient && appointmentDate === targetDate;
      });
      expect(created, 'agendamento criado via UI nao encontrado na API').toBeTruthy();
    } finally {
      try {
        await cleanupAppointmentsByClientName(request, uniqueClient);
        // Remove também o cadastro do cliente de teste
        await apagarClienteDeTeste(request, uniqueClient);
      } catch {
        // Ignore cleanup failures when Playwright already closed the context after timeout.
      }
    }
  });

  test('System Testing: supervisor navega modulos centrais e valida respostas da aplicacao', async ({ page }) => {
    await loginComPerfil(page, 'Supervisor');
    await expect(page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible();

    await page.getByRole('button', { name: /Dashboard/i }).click();
    await expect(page.getByText(/Pr[oó]ximos Clientes/i)).toBeVisible();

    await page.getByRole('button', { name: /^Agenda$/i }).click();
    await expect(page.getByPlaceholder(/Buscar Cliente ou Servi[cç]o/i)).toBeVisible();

    await page.getByRole('button', { name: /Servi[cç]os/i }).click();
    await expect(page.getByPlaceholder(/Buscar servi[cç]o/i)).toBeVisible();

    const rhModuleButton = page.getByRole('button', { name: /Acessar M[oó]dulo RH/i });
    if (await rhModuleButton.isVisible()) {
      await rhModuleButton.click();
      await page.getByRole('button', { name: /Grade de Escalas/i }).click();
      await expect(page.getByRole('button', { name: /Nova Escala/i })).toBeVisible();

      await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
      await expect(page.getByPlaceholder(/Buscar profissional/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Criar Usu[aá]rio/i })).toBeVisible();

      await page.getByRole('button', { name: /Voltar para Opera[cç][aã]o/i }).click();
    } else {
      const escalaButton = page.getByRole('button', { name: /Escalas da Equipe|Grade de Escalas/i });
      if (await escalaButton.isVisible()) {
        await escalaButton.click();
        await expect(page.getByRole('button', { name: /Nova Escala/i })).toBeVisible();
      }

      const teamButton = page.getByRole('button', { name: /Profissionais e Cargos|^Configura[cç][oõ]es$|^Equipe$/i });
      if (await teamButton.isVisible()) {
        await teamButton.click();
        await expect(page.getByPlaceholder(/Buscar profissional/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /Criar Usu[aá]rio/i })).toBeVisible();
      }
    }
  });

  test('Simulacao de Usuario Final: supervisor e colaborador usam o sistema em paralelo', async ({ browser }) => {
    const supervisorContext = await browser.newContext();
    const collaboratorContext = await browser.newContext();
    const supervisorPage = await supervisorContext.newPage();
    const collaboratorPage = await collaboratorContext.newPage();

    try {
      await Promise.all([
        loginComPerfil(supervisorPage, 'Supervisor'),
        loginComPerfil(collaboratorPage, 'Colaborador'),
      ]);

      await Promise.all([
        (async () => {
          await expect(supervisorPage.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible();
          await supervisorPage.getByRole('button', { name: /Lista de Hoje/i }).click();
          await expect(supervisorPage.getByRole('heading', { name: /Pr[oó]ximos atendimentos/i })).toBeVisible();
        })(),
        (async () => {
          await expect(collaboratorPage.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();
          await collaboratorPage.getByRole('button', { name: /Clientes/i }).click();
          await collaboratorPage.getByRole('button', { name: /Agenda/i }).click();
          await expect(collaboratorPage.getByRole('button', { name: /Agendar/i })).toBeVisible();
        })(),
      ]);
    } finally {
      await Promise.all([supervisorContext.close(), collaboratorContext.close()]);
    }
  });
});
