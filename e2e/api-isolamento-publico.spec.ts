import { test, expect } from '@playwright/test';
import { apiBase } from './credenciais';

/**
 * Isolamento entre o autoatendimento (público) e o painel interno, pelo lado da API:
 * rotas internas sem login respondem 401/403 e as públicas não vazam dados internos.
 */

const CAMPOS_INTERNOS = ['email', 'cpf', 'cargo', 'usuario', 'senha', 'papel', 'diasTrabalho', 'tipoEscala', 'turnoPadrao', 'comissaoPercentual', 'profissionaisPermitidos', 'mensagensLembrete', 'lembretePedeConfirmacao', 'versaoToken'];
const chavesDe = (valor: unknown, achadas = new Set<string>()): Set<string> => {
  if (Array.isArray(valor)) valor.forEach((v) => chavesDe(v, achadas));
  else if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) { achadas.add(k); chavesDe(v, achadas); }
  return achadas;
};
const amanha = () => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

test('rotas internas sem login: 401 (ou 403), nunca dados', async ({ request }) => {
  const internas: Array<[string, string]> = [
    ['GET', '/colaboradores'], ['GET', '/clientes'], ['GET', '/agendamentos'], ['GET', '/escala/overrides?month=2026-12'],
    ['GET', '/turnos'], ['GET', '/trocas-turno'], ['GET', '/relatorios/financeiro?de=2026-11-01&ate=2026-11-30'],
    ['GET', '/auditoria'], ['GET', '/whatsapp/qr'], ['GET', '/whatsapp/mensagens'], ['GET', '/feriados'],
    ['PUT', '/empresa/config'], ['POST', '/escala/override'], ['POST', '/clientes'], ['PUT', '/autoatendimento/config'],
  ];
  for (const [metodo, caminho] of internas) {
    const r = await request.fetch(`${apiBase()}${caminho}`, { method: metodo, data: metodo === 'GET' ? undefined : {} });
    expect([401, 403], `${metodo} ${caminho} respondeu ${r.status()}`).toContain(r.status());
    expect(JSON.stringify(await r.json().catch(() => ({})))).not.toMatch(/@|"cpf"|"telefone"/);
  }
});

test('rotas públicas do totem: só o necessário, sem dados internos de equipe nem da empresa', async ({ request }) => {
  const empresa = await (await request.get(`${apiBase()}/autoatendimento/empresa`)).json();
  const config = await (await request.get(`${apiBase()}/empresa/config`)).json();
  const servicos = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as Array<{ id: string }>;
  const salas = await (await request.get(`${apiBase()}/autoatendimento/salas`)).json();
  const respostas: unknown[] = [empresa, config, servicos, salas];
  if (servicos[0]) {
    const disp = await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${amanha()}&servicoId=${servicos[0].id}`);
    expect(disp.status(), await disp.text()).toBe(200);
    respostas.push(await disp.json());
  }
  for (const resposta of respostas) {
    const vazados = CAMPOS_INTERNOS.filter((c) => chavesDe(resposta).has(c));
    expect(vazados, JSON.stringify(resposta).slice(0, 300)).toEqual([]);
  }
  expect(empresa.nomeEmpresa).toBeTruthy();
});

test('saúde: /health responde ok sem revelar nada além disso', async ({ request }) => {
  const r = await request.get(`${apiBase()}/health`);
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ status: 'ok', versao: expect.any(String) });
});
