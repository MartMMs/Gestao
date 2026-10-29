import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Contas criadas por backend/prisma/seed.ci.ts; a senha vem de E2E_PASSWORD (nunca fixa no código)
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? '';
if (!E2E_PASSWORD) {
  throw new Error('Defina E2E_PASSWORD (no .env ou no ambiente) e rode `npm --prefix backend run seed:ci`.');
}

export const CONTAS = {
  admin: 'admin@serenidade.com',
  supervisor: 'supervisor@serenidade.com',
  colaboradora: 'helena@serenidade.com',
  colaboradoraAlternativa: 'ana@serenidade.com',
} as const;

// Login pela tela digitando e-mail e senha
export async function loginPelaTela(page: Page, email: string) {
  await page.getByRole('textbox', { name: /E-mail/i }).fill(email);
  await page.getByRole('textbox', { name: /Senha/i }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /Entrar/i }).click();
  await expect(page.getByText('Carregando dados do sistema...')).toBeHidden({ timeout: 90_000 });
}

// CPF aleatório com dígitos verificadores válidos (a API recusa CPFs inválidos)
export function gerarCpfValido(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digito = (digitos: number[], peso: number) => {
    const resto = (digitos.reduce((t, d, i) => t + d * (peso - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base, 10);
  const d2 = digito([...base, d1], 11);
  return [...base, d1, d2].join('');
}

const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';

// Nome único por execução (só letras, como o totem exige), para a limpeza apagar só o que o teste criou
export const nomeClienteTeste = (base: string) =>
  `${base} Teste ${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;

// No totem, escolhe um dia futuro (3 a 12 dias à frente) para não depender das vagas de hoje
export async function escolherDiaFuturoNoTotem(page: Page) {
  const offset = 3 + Math.floor(Math.random() * 10);
  const dia = new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  await page.locator(`button[data-date="${dia}"]`).click();
}

// Apaga (pela API de supervisão) os clientes de teste com esse nome e os agendamentos deles
export async function apagarClienteDeTeste(request: APIRequestContext, nome: string) {
  const login = await request.post(`${apiBase()}/login`, { data: { email: CONTAS.supervisor, senha: E2E_PASSWORD } });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };
  const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>;
  for (const cliente of clientes.filter((c) => c.nome === nome)) {
    await request.delete(`${apiBase()}/clientes/${cliente.id}`, { headers });
  }
}
