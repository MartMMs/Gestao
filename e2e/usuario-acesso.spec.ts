import { randomBytes } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { CODIGO_DESAFIO_NECESSARIO, CODIGO_ESPERA } from '../shared/codigosErro';
import { resolverDesafio } from '../shared/provaDeTrabalho';
import { CONTAS, apiBase, authHeaders, loginPelaTela, postLogin } from './credenciais';

/**
 * Usuário de acesso (login sem e-mail): limites de tentativa por conta, o que cada papel vê da equipe, cadastro
 * simultâneo, troca do próprio usuário e edição que não apaga a especialidade.
 * Contas próprias com prefixo "ua": errar senha das contas compartilhadas travaria os outros testes.
 */
const SENHA = `Teste-${randomBytes(12).toString('base64url')}`;
const marca = () => randomBytes(4).toString('hex').replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]);

async function criarConta(request: APIRequestContext, dados: Record<string, unknown>) {
  const admin = await authHeaders(request, CONTAS.admin);
  const res = await request.post(`${apiBase()}/colaboradores`, { headers: admin, data: { senha: SENHA, papel: 'collaborator', cargo: 'Teste', ...dados } });
  expect(res.status(), await res.text()).toBe(201);
  const conta = await res.json();
  return { ...conta, apagar: () => request.delete(`${apiBase()}/colaboradores/${conta.id}`, { headers: admin }) };
}

const entrar = (request: APIRequestContext, login: string, senha: string) =>
  request.post(`${apiBase()}/login`, { data: { email: login, senha }, headers: { 'X-Auth-Mode': 'token' } });

// Erro de senha que de fato conta: com o IP em modo de segurança (suíte inteira erra senhas), resolve a prova antes
async function errarSenha(request: APIRequestContext, login: string) {
  let res = await entrar(request, login, 'errada-123');
  const corpo = await res.json();
  if (corpo.code === CODIGO_DESAFIO_NECESSARIO) {
    const nonce = await resolverDesafio(corpo.desafio);
    res = await request.post(`${apiBase()}/login`, { data: { email: login, senha: 'errada-123', desafio: { id: corpo.desafio.id, nonce } }, headers: { 'X-Auth-Mode': 'token' } });
  }
  expect(res.status(), await res.text()).toBe(401);
}

test.describe('Usuário de acesso', () => {
  test('usuário e e-mail da mesma conta dividem o limite de erros (não são duas cotas)', async ({ request }) => {
    const m = marca();
    const conta = await criarConta(request, { nome: `Ua Limite ${m}`, usuario: `ua.${m}`, email: `ua.${m}@teste.local` });
    try {
      // 4 erros pelo e-mail e o 5º pelo usuário: só somados na mesma conta chegam aos 5 que ligam a espera.
      // (A espera é conferida antes do modo de segurança do IP: o teste não depende de como está o IP)
      for (let i = 0; i < 4; i += 1) await errarSenha(request, `ua.${m}@teste.local`);
      await errarSenha(request, `ua.${m}`);
      // Voltar ao e-mail (em outra caixa) cai na espera da conta: não há uma segunda cota
      const pelaOutraPorta = await entrar(request, `UA.${m}@TESTE.LOCAL`, SENHA);
      expect(pelaOutraPorta.status()).toBe(429);
      expect((await pelaOutraPorta.json()).code).toBe(CODIGO_ESPERA);
    } finally {
      await conta.apagar();
    }
  });

  test('usuário de acesso e senha provisória pendente só aparecem para supervisão (e na própria conta)', async ({ request }) => {
    const m = marca();
    const alvo = await criarConta(request, { nome: `Ua Visivel ${m}`, usuario: `ua.vis.${m}`, papel: 'supervisor' });
    try {
      const ver = async (conta: string) => {
        const lista = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, conta) })).json()) as Array<Record<string, unknown>>;
        return { outro: lista.find((c) => c.id === alvo.id)!, proprio: lista.find((c) => c.email === conta)! };
      };
      for (const conta of [CONTAS.colaboradora, CONTAS.recepcao]) {
        const { outro, proprio } = await ver(conta);
        expect(outro, conta).not.toHaveProperty('usuario');
        expect(outro, conta).not.toHaveProperty('trocarSenha');
        expect(proprio, conta).toHaveProperty('trocarSenha');
      }
      expect((await ver(CONTAS.supervisor)).outro).toMatchObject({ usuario: `ua.vis.${m}`, trocarSenha: true });
    } finally {
      await alvo.apagar();
    }
  });

  test('cadastros simultâneos com o mesmo usuário: um grava, os outros recebem 409 (não 500)', async ({ request }) => {
    const m = marca();
    const admin = await authHeaders(request, CONTAS.admin);
    const respostas = await Promise.all([1, 2, 3].map((n) => request.post(`${apiBase()}/colaboradores`, {
      headers: admin, data: { nome: `Ua Corrida ${m} ${'abc'[n - 1]}`, usuario: `ua.corrida.${m}`, senha: SENHA, cargo: 'Teste' },
    })));
    const criados = await Promise.all(respostas.filter((r) => r.status() === 201).map((r) => r.json()));
    try {
      expect(respostas.map((r) => r.status()).sort()).toEqual([201, 409, 409]);
      for (const r of respostas.filter((x) => x.status() === 409)) expect((await r.json()).erro).toBe('Este usuário de acesso já está em uso.');
    } finally {
      for (const c of criados) await request.delete(`${apiBase()}/colaboradores/${c.id}`, { headers: admin });
    }
  });

  test('trocar o próprio usuário pela tela pede a senha atual e entra com o novo', async ({ page, request }) => {
    const m = marca();
    const conta = await criarConta(request, { nome: `Ua Proprio ${m}`, usuario: `ua.prop.${m}`, papel: 'supervisor' });
    try {
      // Sai da senha provisória pela API (a tela de troca não é o assunto aqui)
      const sessao = await postLogin(request, { data: { email: `ua.prop.${m}`, senha: SENHA }, headers: { 'X-Auth-Mode': 'token' } });
      const token = (await sessao.json()).token;
      expect((await request.post(`${apiBase()}/minha-senha`, { headers: { Authorization: `Bearer ${token}` }, data: { senhaAtual: SENHA, senha: `${SENHA}-2` } })).ok()).toBeTruthy();

      await page.goto('/');
      await loginPelaTela(page, `ua.prop.${m}`, `${SENHA}-2`);
      await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
      await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
      await page.getByPlaceholder('Buscar profissional...').fill(`Ua Proprio ${m}`);
      await page.getByTitle('Editar').first().click();
      const dialogo = page.getByRole('dialog', { name: /Editar Colaborador/i });
      // Sem mexer no usuário, a senha atual não é pedida
      await expect(dialogo.getByLabel('Sua senha atual')).toHaveCount(0);
      await dialogo.getByLabel('Usuário de acesso').fill(`ua.novo.${m}`);
      await dialogo.getByLabel('Sua senha atual').fill(`${SENHA}-2`);
      await dialogo.getByRole('button', { name: /Salvar Alterações/i }).click();
      await expect(dialogo).toBeHidden();
      // A aba recebeu a sessão nova: continua dentro do sistema, inclusive depois de recarregar
      await expect(page.getByText(/Sua sessão expirou/i)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Entrar' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Profissionais e Cargos|Acessar Módulo RH/i }).first()).toBeVisible();
      const comNovo = await postLogin(request, { data: { email: `ua.novo.${m}`, senha: `${SENHA}-2` }, headers: { 'X-Auth-Mode': 'token' } });
      expect(comNovo.status(), await comNovo.text()).toBe(200);
      const comAntigo = await postLogin(request, { data: { email: `ua.prop.${m}`, senha: `${SENHA}-2` }, headers: { 'X-Auth-Mode': 'token' } });
      expect(comAntigo.status()).toBe(401);
    } finally {
      await conta.apagar();
    }
  });

  test('editar e salvar sem mexer não troca a especialidade pelo cargo', async ({ page, request }) => {
    const m = marca();
    const conta = await criarConta(request, { nome: `Ua Especialidade ${m}`, usuario: `ua.esp.${m}`, cargo: 'Massagista', especialidade: 'Massagem Relaxante' });
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
      await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
      await page.getByPlaceholder('Buscar profissional...').fill(`Ua Especialidade ${m}`);
      await page.getByTitle('Editar').first().click();
      const dialogo = page.getByRole('dialog', { name: /Editar Colaborador/i });
      await dialogo.getByRole('button', { name: /Salvar Alterações/i }).click();
      await expect(dialogo).toBeHidden();
      const lista = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; especialidade: string; cargo: string }>;
      expect(lista.find((c) => c.id === conta.id)).toMatchObject({ especialidade: 'Massagem Relaxante', cargo: 'Massagista' });
    } finally {
      await conta.apagar();
    }
  });
  test('ninguém muda a própria função de acesso (nem o admin)', async ({ request }) => {
    const m = marca();
    const conta = await criarConta(request, { nome: `Ua Funcao ${m}`, usuario: `ua.func.${m}`, papel: 'supervisor' });
    try {
      const sessao = await postLogin(request, { data: { email: `ua.func.${m}`, senha: SENHA }, headers: { 'X-Auth-Mode': 'token' } });
      const token = (await sessao.json()).token;
      await request.post(`${apiBase()}/minha-senha`, { headers: { Authorization: `Bearer ${token}` }, data: { senhaAtual: SENHA, senha: `${SENHA}-2` } });
      const nova = await postLogin(request, { data: { email: `ua.func.${m}`, senha: `${SENHA}-2` }, headers: { 'X-Auth-Mode': 'token' } });
      const proprio = { Authorization: `Bearer ${(await nova.json()).token}` };
      const res = await request.put(`${apiBase()}/colaboradores/${conta.id}`, { headers: proprio, data: { papel: 'collaborator' } });
      expect(res.status()).toBe(400);
      const lista = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; papel: string }>;
      expect(lista.find((c) => c.id === conta.id)?.papel).toBe('supervisor');
    } finally {
      await conta.apagar();
    }
  });

  test('a especialidade acompanha o cargo só quando era o próprio cargo', async ({ request }) => {
    const m = marca();
    const admin = await authHeaders(request, CONTAS.admin);
    const igual = await criarConta(request, { nome: `Ua Cargo Igual ${m}`, usuario: `ua.ci.${m}`, cargo: 'Massagista' });
    const diferente = await criarConta(request, { nome: `Ua Cargo Dif ${m}`, usuario: `ua.cd.${m}`, cargo: 'Massagista', especialidade: 'Massagem Relaxante' });
    try {
      expect(igual.especialidade).toBe('Massagista');
      for (const c of [igual, diferente]) {
        expect((await request.put(`${apiBase()}/colaboradores/${c.id}`, { headers: admin, data: { cargo: 'Terapeuta' } })).status()).toBe(200);
      }
      const lista = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; especialidade: string; cargo: string }>;
      expect(lista.find((c) => c.id === igual.id)).toMatchObject({ cargo: 'Terapeuta', especialidade: 'Terapeuta' });
      expect(lista.find((c) => c.id === diferente.id)).toMatchObject({ cargo: 'Terapeuta', especialidade: 'Massagem Relaxante' });
    } finally {
      await igual.apagar();
      await diferente.apagar();
    }
  });

  test('Tab não sai do modal da Política (o foco fica no documento)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Política de Privacidade' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Política de Privacidade' });
    await expect(dialogo).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press(i === 1 ? 'Shift+Tab' : 'Tab');
      expect(await dialogo.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });
});
