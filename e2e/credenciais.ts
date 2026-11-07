import { resolverDesafio } from '../shared/provaDeTrabalho';
import { CODIGO_CONFERINDO, CODIGO_DESAFIO_NECESSARIO } from '../shared/codigosErro';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

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
  recepcao: 'recepcao@serenidade.com',
} as const;

// Login pela tela digitando o login (e-mail ou usuário de acesso) e a senha (padrão: a das contas do seed)
export async function loginPelaTela(page: Page, email: string, senha = E2E_PASSWORD) {
  await page.getByRole('textbox', { name: /E-mail/i }).fill(email);
  await page.getByRole('textbox', { name: /Senha/i }).fill(senha);
  await page.getByRole('button', { name: /Entrar/i }).click();
  // Em modo de segurança o login resolve uma prova de trabalho antes de entrar: espera o botão terminar
  await expect(page.getByRole('button', { name: /Acessando|Confirmando/i })).toHaveCount(0, { timeout: 90_000 });
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

export const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';

/**
 * POST /login que, como o navegador, resolve a prova de trabalho quando o servidor está em modo de segurança
 * (muitos erros recentes no mesmo e-mail ou IP: os testes do próprio modo de segurança erram senhas de propósito).
 */
export async function postLogin(request: APIRequestContext, opcoes: { data: Record<string, unknown>; headers?: Record<string, string> }): Promise<APIResponse> {
  let res: APIResponse = await request.post(`${apiBase()}/login`, opcoes);
  // Vários testes entram com a mesma conta ao mesmo tempo: o servidor confere uma senha por vez (aparelho novo)
  for (let rodada = 0; rodada < 10 && res.status() === 429; rodada += 1) {
    if ((await res.json().catch(() => null))?.code !== CODIGO_CONFERINDO) break;
    await new Promise((resolver) => setTimeout(resolver, 300 + Math.random() * 700));
    res = await request.post(`${apiBase()}/login`, opcoes);
  }
  // Falha de login aqui é falha do teste, não "sessão expirada" lá na frente com um token vazio
  if (res.status() === 429) throw new Error(`Login recusado por limite de tentativas: ${await res.text()}`);
  const corpo = res.status() === 401 ? await res.json().catch(() => null) : null;
  if (corpo?.code === CODIGO_DESAFIO_NECESSARIO) {
    const nonce = await resolverDesafio(corpo.desafio);
    res = await request.post(`${apiBase()}/login`, { ...opcoes, data: { ...opcoes.data, desafio: { id: corpo.desafio.id, nonce } } });
  }
  return res;
}

// Nome único por execução (só letras, como o totem exige), para a limpeza apagar só o que o teste criou
export const nomeClienteTeste = (base: string) =>
  `${base} Teste ${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;

// No totem, escolhe um dia futuro (3 a 12 dias à frente) para não depender das vagas de hoje
export async function escolherDiaFuturoNoTotem(page: Page) {
  const offset = 3 + Math.floor(Math.random() * 10);
  const dia = new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  await page.locator(`button[data-date="${dia}"]`).click();
}

/**
 * Escolhe dia e horário livres no totem e garante a reserva. Sorteia de novo (outro dia, outro horário) quando o dia
 * não tem vaga (domingo, feriado, agenda cheia) ou quando outra execução em paralelo pegou o horário antes: nesse
 * caso o totem precisa mostrar o aviso e deixar escolher outro, e é isso que o laço também confere.
 */
export async function reservarHorarioNoTotem(page: Page) {
  const ficha = page.getByRole('heading', { name: /Seus dados para o atendimento/i });
  const aviso = page.getByText(/escolha outro/i);
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    await escolherDiaFuturoNoTotem(page);
    const livres = page.locator('button:has(span:has-text(":")):not([disabled])');
    // Espera os horários do dia carregarem: algum horário (livre ou ocupado) ou a mensagem de dia sem vaga
    const qualquerHorario = page.locator('button:has(span:has-text(":"))');
    const semVaga = page.getByText(/Nenhum hor[aá]rio livre nesta data/i);
    await expect(qualquerHorario.first().or(semVaga)).toBeVisible({ timeout: 15_000 });
    const total = await livres.count();
    if (total === 0) continue; // dia sem vaga ou todo ocupado: sorteia outro
    await livres.nth(Math.floor(Math.random() * total)).click();
    const btnLock = page.getByRole('button', { name: /Garantir Reserva/i });
    await expect(btnLock).toBeEnabled({ timeout: 10_000 });
    await btnLock.click();
    await expect(ficha.or(aviso)).toBeVisible({ timeout: 15_000 });
    if (await ficha.isVisible()) return;
  }
  throw new Error('Nenhum horário livre no totem em 6 tentativas.');
}

// Repete uma chamada que falhou por rede (ex.: ECONNRESET com a API sob carga da suíte); erro de regra não se repete
const comRepeticao = async <T>(chamada: () => Promise<T>, tentativas = 3): Promise<T> => {
  for (let i = 1; ; i += 1) {
    try {
      return await chamada();
    } catch (error) {
      if (i >= tentativas || !/ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT/.test(String(error))) throw error;
      await new Promise((resolver) => setTimeout(resolver, 300 * i));
    }
  }
};

/**
 * Apaga (pela API de supervisão) os clientes de teste com esses nomes e os agendamentos deles. Tenta todos mesmo que
 * um falhe (uma falha de rede no primeiro não deixa os outros no banco) e só então acusa o erro.
 */
export async function apagarClienteDeTeste(request: APIRequestContext, nomes: string | string[]) {
  const headers = await comRepeticao(() => authHeaders(request, CONTAS.supervisor));
  const clientes = await comRepeticao(async () => (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>);
  const falhas: string[] = [];
  for (const nome of Array.isArray(nomes) ? nomes : [nomes]) {
    // Também os cadastros à parte que o totem cria para homônimos ("Nome (tel. final 22)")
    for (const cliente of clientes.filter((c) => c.nome === nome || c.nome.startsWith(`${nome} (tel. final `))) {
      try {
        // Cliente com atendimento marcado não pode ser excluído (409): apaga antes os agendamentos dele. Sem isso cada
        // execução deixava uma reserva do totem para trás, até lotar os dias e o teste não achar horário livre
        const agendamentos = await comRepeticao(async () => (await (await request.get(`${apiBase()}/agendamentos?clienteId=${cliente.id}`, { headers })).json()) as Array<{ id: string; atualizadoEm: string }>);
        for (const ag of agendamentos) await comRepeticao(() => request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers, data: { version: ag.atualizadoEm } }));
        const removido = await comRepeticao(() => request.delete(`${apiBase()}/clientes/${cliente.id}`, { headers }));
        if (!removido.ok()) falhas.push(`${nome}: ${await removido.text()}`);
      } catch (error) {
        falhas.push(`${nome}: ${String(error)}`);
      }
    }
  }
  expect(falhas, 'limpeza dos clientes de teste').toEqual([]);
}

// Cabeçalho de autenticação (token) de uma conta de teste; falha o teste se o login não passar
export async function authHeaders(request: APIRequestContext, email: string, senha = E2E_PASSWORD) {
  const res = await postLogin(request, { data: { email, senha }, headers: { 'X-Auth-Mode': 'token' } });
  expect(res.ok(), `login de ${email}: ${await res.text()}`).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).token}` };
}

// Dia daqui a N dias no fuso da empresa (AAAA-MM-DD): perto da meia-noite UTC o dia de São Paulo ainda é o anterior
export const diaFuturo = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// Apaga (pela API) o colaborador de teste com esse e-mail, se existir: limpeza de teste que cria conta pela tela
export async function apagarColaboradorDeTeste(request: APIRequestContext, email: string) {
  const headers = await authHeaders(request, CONTAS.admin);
  const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers })).json()) as Array<{ id: string; email: string }>;
  const alvo = equipe.find((c) => c.email === email);
  if (alvo) expect((await request.delete(`${apiBase()}/colaboradores/${alvo.id}`, { headers })).ok(), `limpeza de ${email}`).toBeTruthy();
}
