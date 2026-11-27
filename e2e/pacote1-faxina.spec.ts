import { test, expect } from '@playwright/test';
import {
  CONTAS,
  apiBase,
  apagarClienteDeTeste,
  authHeaders,
  gerarCpfValido,
  loginPelaTela,
  nomeClienteTeste,
  reservarHorarioNoTotem,
  descartarAlteracoes,
} from './credenciais';

const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const somarDias = (iso: string, dias: number) =>
  new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);

test.describe('Pacote 1 — Faxina Visual, Permissões e Correções', () => {
  test('Recepção: enxerga folga do profissional na Agenda via endpoint operacional e cadastra cliente via + Novo cliente', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const recepcao = await authHeaders(request, CONTAS.recepcao);
    const colab = await authHeaders(request, CONTAS.colaboradora);
    const tag = sufixo();
    const profNome = `Prof Folga ${tag}`;
    const clienteNome = nomeClienteTeste('Cliente Recepcao');
    const dataFolga = somarDias(hojeSP(), 2);
    const mesFolga = dataFolga.slice(0, 7);

    // Cria profissional de teste com folga marcada em dataFolga
    const criadoProf = await request.post(`${apiBase()}/colaboradores`, {
      headers: admin,
      data: {
        nome: profNome,
        email: `prof.folga.${tag}@teste.com`,
        senha: `Provisoria!${tag}9`,
        especialidade: 'Massagem',
        tipoEscala: '5x2',
      },
    });
    expect(criadoProf.status(), await criadoProf.text()).toBe(201);
    const profId = (await criadoProf.json()).id as string;

    try {
      const ov = await request.post(`${apiBase()}/escala/override`, {
        headers: admin,
        data: { colaboradorId: profId, data: dataFolga, tipo: 'folga', descricao: 'Motivo confidencial RH' },
      });
      expect(ov.ok(), await ov.text()).toBeTruthy();

      // Endpoint operacional somente leitura: Recepção tem 200 sem dados administrativos do RH; Colaborador recebe 403
      const opColab = await request.get(`${apiBase()}/escala/operacional?month=${mesFolga}`, { headers: colab });
      expect(opColab.status()).toBe(403);

      const opRecep = await request.get(`${apiBase()}/escala/operacional?month=${mesFolga}`, { headers: recepcao });
      expect(opRecep.status(), await opRecep.text()).toBe(200);
      const diasOp = (await opRecep.json()) as Array<{ colaboradorId: string; data: string; tipo: string; turno: string | null; descricao?: string }>;
      const diaProf = diasOp.find((d) => d.colaboradorId === profId && d.data === dataFolga);
      expect(diaProf).toBeDefined();
      expect(diaProf?.tipo).toBe('folga');
      expect(diaProf?.descricao).toBeUndefined();

      // Login como Recepção e navega até dataFolga na Agenda
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await expect(page.getByRole('heading', { name: 'Portal da Recepção' })).toBeVisible();
      await expect(page.getByText(/Dica operacional/i)).toHaveCount(0);

      // Seleciona dataFolga no mini calendário (muda mês se dataFolga for no mês seguinte)
      if (mesFolga !== hojeSP().slice(0, 7)) {
        await page.getByRole('button', { name: /chevron_right/i }).first().click();
      }
      const diaNum = Number(dataFolga.slice(8, 10));
      await page.getByRole('button', { name: String(diaNum), exact: true }).first().click();

      // Coluna do profissional exibe FOLGA e bloqueio visual "Profissional Indisponível"
      const primeiroNome = profNome.split(' ')[0];
      await expect(page.getByRole('heading', { name: primeiroNome, level: 4 }).first()).toBeVisible();
      await expect(page.getByText(/Profissional Indisponível/i).first()).toBeVisible();
      await expect(page.getByText('De folga no dia')).toBeVisible();

      // Aba Clientes da Recepção: + Novo cliente funciona; Importar planilha não aparece; sem lixeira desabilitada
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await expect(page.getByRole('button', { name: /Importar planilha/i })).toHaveCount(0);
      const btnNovo = page.getByRole('button', { name: /Novo cliente/i });
      await expect(btnNovo).toBeVisible();
      await btnNovo.click();

      const modal = page.getByRole('dialog', { name: 'Novo cliente' });
      await modal.getByLabel('Nome completo').fill(clienteNome);
      await modal.getByLabel('Telefone (opcional)').fill('11988887766');
      await modal.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(modal).toBeHidden({ timeout: 10_000 });
      await page.getByRole('searchbox', { name: 'Buscar cliente' }).fill(clienteNome);
      await expect(page.getByRole('button', { name: clienteNome })).toBeVisible({ timeout: 10_000 });
    } finally {
      await apagarClienteDeTeste(request, clienteNome);
      await request.delete(`${apiBase()}/colaboradores/${profId}`, { headers: admin });
    }
  });

  test('Colaborador: sem Solicitar Troca, Próximos atendimentos travado à própria agenda e busca sem CPF/telefone', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const colab = await authHeaders(request, CONTAS.colaboradora);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email: string | null }>;
    const helena = equipe.find((c) => c.email === CONTAS.colaboradora);
    const ana = equipe.find((c) => c.email === CONTAS.colaboradoraAlternativa);
    expect(helena?.id).toBeTruthy();
    expect(ana?.id).toBeTruthy();

    const cpfUnico = gerarCpfValido();
    const telefoneUnico = '11987651234';
    const nomeCliente = nomeClienteTeste('Privacidade Colab');
    let agendamentoId: string | null = null;

    try {
      // Cria cliente com CPF e telefone conhecidos e vincula atendimento à Helena para que apareça na base dela
      const cRes = await request.post(`${apiBase()}/clientes`, {
        headers: admin,
        data: { nome: nomeCliente, cpf: cpfUnico, telefone: telefoneUnico },
      });
      expect(cRes.status(), await cRes.text()).toBe(201);
      const clienteCriado = (await cRes.json()) as { id: string };
      const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: admin })).json()) as Array<{ nome: string }>;
      expect(servicos.length).toBeGreaterThan(0);
      // Encontra um horário futuro livre para Helena sem colidir com dados pré-existentes
      let agCriado: { id: string } | null = null;
      for (const offset of [6, 7, 8, 9, 10, 11, 12, 13, 14]) {
        const agRes = await request.post(`${apiBase()}/agendamentos`, {
          headers: admin,
          data: {
            collaboratorId: helena!.id,
            date: somarDias(hojeSP(), offset),
            time: '11:00',
            serviceNames: [servicos[0].nome],
            clientId: clienteCriado.id,
            clientName: nomeCliente,
          },
        });
        if (agRes.status() === 201) {
          agCriado = (await agRes.json()) as { id: string };
          break;
        }
      }
      expect(agCriado?.id).toBeTruthy();
      agendamentoId = agCriado!.id;

      // Backend: colaborador NÃO pode consultar agendamentos de outro profissional
      const agOutro = await request.get(`${apiBase()}/agendamentos?profissionalId=${ana!.id}`, { headers: colab });
      expect(agOutro.status()).toBe(403);
      const agProprio = await request.get(`${apiBase()}/agendamentos?profissionalId=${helena!.id}`, { headers: colab });
      expect(agProprio.status()).toBe(200);

      // Backend: busca de clientes pelo colaborador NÃO casa por CPF nem por telefone, mas casa por nome
      const buscaCpf = await request.get(`${apiBase()}/clientes?q=${cpfUnico}`, { headers: colab });
      expect(buscaCpf.status()).toBe(200);
      expect((await buscaCpf.json()) as unknown[]).toHaveLength(0);

      const buscaTel = await request.get(`${apiBase()}/clientes?q=${telefoneUnico}`, { headers: colab });
      expect(buscaTel.status()).toBe(200);
      expect((await buscaTel.json()) as unknown[]).toHaveLength(0);

      const buscaNome = await request.get(`${apiBase()}/clientes?q=${encodeURIComponent(nomeCliente)}`, { headers: colab });
      expect(buscaNome.status()).toBe(200);
      expect(((await buscaNome.json()) as Array<{ nome: string }>).some((c) => c.nome === nomeCliente)).toBe(true);

      // UI do Colaborador
      await page.goto('/');
      await loginPelaTela(page, CONTAS.colaboradora);
      await expect(page.getByRole('heading', { name: 'Portal do Colaborador' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Portal' })).toHaveCount(0);

      // Sem Solicitar Troca, mas + Agendar preservado
      await expect(page.getByRole('button', { name: /Solicitar Troca/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Agendar/i })).toBeVisible();

      // Modal Próximos atendimentos: sem seletor de profissional e subtítulo pessoal
      await page.getByRole('button', { name: /Próximos/i }).click();
      const modalProximos = page.getByRole('dialog');
      await expect(modalProximos.getByText('Veja seus atendimentos de hoje e dos próximos dias.')).toBeVisible();
      await expect(modalProximos.getByText('Todos os profissionais')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(modalProximos).toBeHidden();

      // Aba Clientes: placeholder restrito a nome, busca por telefone não acha e edição continua disponível
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      const campoBusca = page.getByPlaceholder('Buscar por nome...');
      await expect(campoBusca).toBeVisible();
      await campoBusca.fill(telefoneUnico);
      await expect(page.getByText(nomeCliente)).toHaveCount(0);
      await campoBusca.fill(nomeCliente);
      await expect(page.getByText(nomeCliente)).toBeVisible();
      // Botão de edição de ficha/cliente preservado, sem lixeira desabilitada
      const linha = page.locator('tr').filter({ hasText: nomeCliente });
      await expect(linha.locator('button[disabled]')).toHaveCount(0);
      await expect(linha.getByRole('button').first()).toBeEnabled();
    } finally {
      if (agendamentoId) await request.delete(`${apiBase()}/agendamentos/${agendamentoId}`, { headers: admin });
      await apagarClienteDeTeste(request, nomeCliente);
    }
  });

  test('Totem: catálogo limpo, sem datas ISO nas Etapas 2/4/Voucher, frase condicional WhatsApp e telefone mascarado', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const configAtual = await (await request.get(`${apiBase()}/autoatendimento/config`, { headers: admin })).json();
    const nomeCliente = nomeClienteTeste('Totem Faxina');

    // Garante modo sem pagamento para chegar ao voucher sem gateway externo
    await request.put(`${apiBase()}/autoatendimento/config`, {
      headers: admin,
      data: { ativo: true, exigirPagamento: false },
    });

    try {
      await page.goto('/');
      await page.getByRole('button', { name: /Autoatendimento/i }).click();
      await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });

      // Sem "(+15m preparo)" nos cards do catálogo público
      await expect(page.getByText(/preparo\)/i)).toHaveCount(0);

      // Seleciona primeiro serviço e avança para Etapa 2
      const card = page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first();
      await card.click();
      await page.getByRole('button', { name: /Escolher Horário/i }).click();

      // Etapa 2: reserva um horário e valida ausência de datas ISO no rodapé
      await expect(page.getByRole('heading', { name: /Disponibilidade em Tempo Real/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText(/\b20\d{2}-\d{2}-\d{2}\b/);
      await reservarHorarioNoTotem(page);

      // Etapa 3: frase condicional quando WhatsApp não está ativo
      await expect(page.getByRole('heading', { name: /Seus dados para o atendimento/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Usado apenas para contato da recepção sobre o seu agendamento.')).toBeVisible();

      await page.locator('input[placeholder*="Mariana" i]').fill(nomeCliente);
      await page.locator('input[placeholder*="98765" i]').fill('11987654321');
      await page.getByRole('checkbox', { name: /Autorizo .* a usar meus dados pessoais/i }).check();
      await page.getByRole('button', { name: /Revisar e Confirmar|Ir para Pagamento/i }).click();

      // Etapa 4: sem datas em ISO
      await expect(page.getByRole('heading', { name: /Agendamento com Pagamento no Local/i })).toBeVisible({ timeout: 15_000 });
      const textoEtapa4 = await page.locator('body').innerText();
      expect(textoEtapa4).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);

      await page.getByRole('button', { name: /Confirmar Agendamento \(Pagar no Local\)/i }).click();

      // Etapa 5 (Voucher): sem datas em ISO, telefone mascarado e antecedência coerente (sem contradição 10 vs 15)
      await expect(page.getByRole('heading', { name: /Seu Horário Está Garantido/i })).toBeVisible({ timeout: 20_000 });
      const textoVoucher = await page.locator('body').innerText();
      expect(textoVoucher).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(textoVoucher).toContain('(11) 98765-4321');
      expect(textoVoucher).not.toContain('11987654321');
      // Antecedência: o número do destaque é o mesmo de toda orientação de check-in exibida (vale para qualquer seed)
      const destaque = textoVoucher.match(/Chegada recomendada: (\d+) min antes/);
      expect(destaque, 'voucher sem a chegada recomendada').not.toBeNull();
      const citados = [...textoVoucher.matchAll(/(\d+)\s*(?:min|minutos)\s*(?:antes|de anteced[êe]ncia)/gi)].map((m) => m[1]);
      expect(new Set(citados)).toEqual(new Set([destaque![1]]));
    } finally {
      await apagarClienteDeTeste(request, nomeCliente);
      await request.put(`${apiBase()}/autoatendimento/config`, {
        headers: admin,
        data: { ativo: configAtual.ativo ?? true, exigirPagamento: configAtual.exigirPagamento ?? false },
      });
    }
  });

  test('Admin fora de escala/jornada, labels explícitas em Criar Usuário e Supervisor preservando Serviços e Totem', async ({ page }) => {
    // 1. Login como Admin
    await page.goto('/');
    await loginPelaTela(page, CONTAS.admin);

    // Sem sino duplicado de Auditoria CLT no topo
    await expect(page.getByTitle(/Auditoria CLT/i)).toHaveCount(0);

    // Aba Equipe & Papéis: card do Admin não tem jornada nem botão Montar escala
    await page.getByRole('button', { name: /Equipe & Papéis/i }).click();
    const cardAdmin = page.locator('div.rounded-2xl').filter({ hasText: 'Admin E2E' }).first();
    await expect(cardAdmin).toBeVisible();
    await expect(cardAdmin).not.toContainText(/h\/sem|6x1|5x2|12x36/i);
    await expect(cardAdmin.getByTitle('Montar escala')).toHaveCount(0);

    // Modal Criar Usuário: labels explícitas nos campos numéricos e ocultação ao selecionar Admin
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    const modalCriar = page.getByRole('dialog', { name: /Criar Usuário/i });
    await expect(modalCriar.getByLabel('Domingos de folga / mês')).toBeVisible();
    await expect(modalCriar.getByLabel('Carga horária semanal (h)')).toBeVisible();

    await modalCriar.locator('select').first().selectOption('admin');
    await expect(modalCriar.getByLabel('Domingos de folga / mês')).toHaveCount(0);
    await expect(modalCriar.getByLabel('Carga horária semanal (h)')).toHaveCount(0);
    await expect(modalCriar.getByText('Habilidades')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await descartarAlteracoes(page);
    await expect(modalCriar).toBeHidden();

    // Aba Empresa & Segmento: presets colapsados por padrão
    await page.getByRole('button', { name: /Empresa & Segmento/i }).click();
    const botaoPresets = page.getByRole('button', { name: /Alterar modelo de negócio/i });
    await expect(botaoPresets).toBeVisible();
    await expect(botaoPresets).toHaveAttribute('aria-expanded', 'false');

    // Sair e entrar como Supervisor
    await page.getByTitle('Sair').click();
    await loginPelaTela(page, CONTAS.supervisor);

    // Permissões preservadas no Supervisor: abas Serviços e Totem & Autoatendimento
    await expect(page.getByRole('button', { name: /Serviços/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Totem & Autoatendimento/i })).toBeVisible();

    // Módulo RH: sub-abas enxutas e subtítulo sem "controle de ponto"
    await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
    await expect(page.getByText(/controle de ponto/i)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Escalas', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Folgas', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Horas Previstas', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Férias e Afastamentos', exact: true })).toBeVisible();

    // Profissionais e Cargos: abrir perfil (RH) do Admin não mostra abas Dashboard nem Regras de Jornada
    await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
    const cardAdminSup = page.locator('div.rounded-2xl').filter({ hasText: 'Admin E2E' }).first();
    await expect(cardAdminSup).toBeVisible();
    await expect(cardAdminSup.getByTitle('Montar escala')).toHaveCount(0);
    await cardAdminSup.getByTitle('Perfil (RH)').click();
    const modalPerfil = page.getByRole('dialog');
    await expect(modalPerfil).toBeVisible();
    await expect(modalPerfil.getByRole('button', { name: /Dashboard/i })).toHaveCount(0);
    await expect(modalPerfil.getByRole('button', { name: /Regras de Jornada/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(modalPerfil).toBeHidden();
  });
});
