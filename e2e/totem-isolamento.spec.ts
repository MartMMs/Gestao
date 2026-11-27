import { test, expect, type Page } from '@playwright/test';

/**
 * No host do autoatendimento (autoatendimento.<host>), qualquer caminho, inclusive /login e rotas internas,
 * abre o totem. Não existe formulário de login nem link/botão que leve ao painel. (O bloqueio com 404 desses caminhos
 * fica no nginx de produção: docs/nginx-https.conf.example.)
 */

const hostDoTotem = (baseURL: string) => {
  const url = new URL(baseURL);
  url.hostname = `autoatendimento.${url.hostname === '127.0.0.1' ? 'localhost' : url.hostname}`;
  return url.origin;
};

const semCaminhoParaOPainel = async (page: Page) => {
  await expect(page.getByLabel('Senha')).toHaveCount(0);
  await expect(page.getByLabel(/usuário ou e-mail/i)).toHaveCount(0);
  const suspeitos = await page.evaluate(() => [...document.querySelectorAll('a, button, [role="link"], [role="button"], form')]
    .filter((el) => /\/login|\/painel|\/admin|\/rh\b/i.test(`${el.getAttribute('href') ?? ''} ${el.getAttribute('action') ?? ''}`)
      || /\b(login|entrar no painel|acesso da equipe|portal|área restrita|admin)\b/i.test(el.textContent ?? ''))
    .map((el) => `${el.tagName}: ${(el.textContent ?? '').trim().slice(0, 40)} ${el.getAttribute('href') ?? ''}`));
  expect(suspeitos).toEqual([]);
};

test.describe('Isolamento do totem', () => {
  for (const caminho of ['/', '/login', '/rh', '/admin', '/painel', '/qualquer-coisa']) {
    test(`host do totem em ${caminho}: abre o autoatendimento, sem login nem link para o painel`, async ({ page, baseURL }) => {
      await page.goto(`${hostDoTotem(baseURL!)}${caminho}`);
      // Tela inicial do autoatendimento (catálogo), nunca a tela de login
      await expect(page.getByText(/Carregando Totem|Escolha|Serviço|Bem-vindo/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveURL(new RegExp(`${caminho.replace('/', '\\/')}$`)); // sem redirecionar para /login
      await semCaminhoParaOPainel(page);
    });
  }
});
