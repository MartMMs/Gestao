import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { NOME_CLIENTE_REMOVIDO, clienteComMesmoNome, mensagemNomeDuplicado, travarNomeCliente } from '../lib/clientes';
import { transacaoComTravas, travarChave } from '../lib/transacao';
import { clientesComAcessoSaude, prepararCliente } from '../lib/privacidade';
import { CODIGO_ANAMNESE_OBRIGATORIA, MENSAGEM_ANAMNESE_OBRIGATORIA, MENSAGEM_FICHA_TOTEM_RESERVADA, forjaFichaDoTotem, temFichaAnamnese } from '../../shared/anamnese';
import { getEmpresaConfig } from '../services/configService';
import { MAX_LINHAS_IMPORTACAO, MENSAGEM_EMAIL_INVALIDO, emailValido, erroNomeCliente, lerCliente, limparTexto, validarImportacao, type DadosCliente } from '../../shared/clientes';
import { LIMITE_OBSERVACAO, MENSAGEM_CPF_INVALIDO, MENSAGEM_TELEFONE_INVALIDO, apenasDigitos, cpfValido, normalizarNome, normalizarTelefone, telefoneValido, valorMascarado } from '../../shared/validadores';

const formatarDataHora = (data: Date) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(data);

export function createClientesRouter(notificar: Notificar) {
  const router = Router();

  router.get('/clientes', verificarToken, async (req, res) => {
    try {
      // Recepção e supervisão veem a carteira toda (agendam para qualquer cliente); o profissional, só os clientes
      // que atende ou já atendeu (minimização de dados da LGPD)
      const clientes = await prisma.cliente.findMany({
        where: {
          removidoEm: null,
          // Mesmo critério do agendamento (resolverCliente): cancelado ou falta não conta como cliente do profissional
          ...(usuarioGerenciaAgenda(req) ? {} : {
            agendamentos: { some: { colaboradorId: getUsuario(req)?.id ?? '', status: { in: ['scheduled', 'completed'] } } },
          }),
        },
        orderBy: { nome: 'asc' },
      });
      // temAnamnese: só se há ficha, sem o conteúdo (quem não vê saúde, como a recepção, também precisa do aviso)
      const comAviso = <T extends { observacao: string | null }>(c: T, original: { observacao: string | null }) => ({ ...c, temAnamnese: temFichaAnamnese(original.observacao) });
      if (usuarioEhSupervisor(req)) return res.json(clientes.map((c) => comAviso(c, c)));
      const meus = await clientesComAcessoSaude(req);
      res.json(clientes.map((c) => comAviso(prepararCliente(c, req, meus.has(c.id)), c)));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar clientes');
    }
  });

  // Grava clientes já validados, todos ou nenhum. Pega as travas de nome e de CPF antes de reler a base (outro
  // cadastro pode ter entrado depois da validação), em ordem fixa para dois envios simultâneos não se cruzarem
  const gravarClientes = (lista: DadosCliente[], observacao: string | null = null) => transacaoComTravas(async (tx) => {
    for (const nome of [...new Set(lista.map((d) => normalizarNome(d.nome)))].sort()) await travarNomeCliente(tx, nome);
    for (const cpf of [...new Set(lista.flatMap((d) => (d.cpf ? [d.cpf] : [])))].sort()) await travarChave(tx, `cliente-cpf:${cpf}`);
    const existentes = await tx.cliente.findMany({ where: { removidoEm: null }, select: { nome: true, cpf: true, codigo: true } });
    const { erros } = validarImportacao(lista, existentes);
    if (erros.length) throw new HttpError(409, erros[0].mensagem);
    return tx.cliente.createManyAndReturn({ data: lista.map((d) => ({ ...d, observacao })) });
  });

  // Cadastro manual (apenas supervisão, como a edição dos dados cadastrais)
  router.post('/clientes', verificarSupervisorToken, async (req, res) => {
    try {
      const { dados, erros } = lerCliente(req.body ?? {});
      if (erros.length) return res.status(400).json({ erro: erros[0].mensagem, erros });
      const observacao = typeof req.body?.observacao === 'string' ? req.body.observacao.slice(0, LIMITE_OBSERVACAO) : '';
      if (forjaFichaDoTotem(observacao, null)) return res.status(400).json({ erro: MENSAGEM_FICHA_TOTEM_RESERVADA });
      if ((await getEmpresaConfig()).exigirAnamnese && !temFichaAnamnese(observacao)) {
        return res.status(400).json({ erro: MENSAGEM_ANAMNESE_OBRIGATORIA, code: CODIGO_ANAMNESE_OBRIGATORIA });
      }
      const [criado] = await gravarClientes([dados], observacao || null);
      notificar();
      res.status(201).json(criado);
    } catch (error) {
      responderErro(res, error, 'Erro ao criar cliente');
    }
  });

  /**
   * Importação por planilha: o navegador lê o arquivo e manda as linhas ({ nome, telefone, cpf, email }).
   * confirmar=false só valida e devolve a prévia; confirmar=true grava tudo numa transação, e só se não houver
   * nenhum erro (com erro, nada é gravado e a resposta traz a prévia).
   */
  router.post('/clientes/importar', verificarSupervisorToken, async (req, res) => {
    try {
      const linhas: unknown = req.body?.linhas;
      if (!Array.isArray(linhas) || linhas.length === 0) return res.status(400).json({ erro: 'A planilha não tem linhas de clientes.' });
      if (linhas.length > MAX_LINHAS_IMPORTACAO) return res.status(400).json({ erro: `Máximo de ${MAX_LINHAS_IMPORTACAO} clientes por planilha. Divida o arquivo.` });
      if (!linhas.every((l) => l && typeof l === 'object' && !Array.isArray(l))) return res.status(400).json({ erro: 'Formato de linhas inválido.' });

      const existentes = await prisma.cliente.findMany({ where: { removidoEm: null }, select: { nome: true, cpf: true, codigo: true } });
      const { validos, erros, ignoradas } = validarImportacao(linhas as Record<string, unknown>[], existentes);
      const previa = { total: linhas.length, validos: validos.length, erros, ignoradas };
      if (req.body?.confirmar !== true) return res.json(previa);
      if (erros.length) return res.status(422).json({ erro: 'A planilha tem erros. Corrija e envie de novo; nada foi gravado.', ...previa });

      const criados = await gravarClientes(validos);
      notificar();
      res.status(201).json({ ...previa, importados: criados.length });
    } catch (error) {
      responderErro(res, error, 'Erro ao importar clientes');
    }
  });

  router.put('/clientes/:id', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const cliente = await prisma.cliente.findUnique({ where: { id } });
      if (!cliente || cliente.removidoEm) return res.status(404).json({ erro: 'Cliente não encontrado.' });

      const { nome, telefone, cpf, email, observacao } = req.body ?? {};
      const dados: Prisma.ClienteUpdateInput = {};

      if (observacao !== undefined) {
        if (observacao !== null && typeof observacao !== 'string') return res.status(400).json({ erro: 'Observação inválida.' });
        if (!usuarioEhSupervisor(req) && !(await clientesComAcessoSaude(req)).has(id)) {
          return res.status(403).json({ erro: 'Você só pode registrar anamnese de clientes que atende.' });
        }
        dados.observacao = observacao ? observacao.slice(0, LIMITE_OBSERVACAO) : null;
        if (forjaFichaDoTotem(dados.observacao, cliente.observacao)) return res.status(400).json({ erro: MENSAGEM_FICHA_TOTEM_RESERVADA });
        // Com a ficha obrigatória, editar não pode tirar a ficha de quem já tem (seria furar a regra pelo cadastro)
        if (temFichaAnamnese(cliente.observacao) && !temFichaAnamnese(dados.observacao) && (await getEmpresaConfig()).exigirAnamnese) {
          return res.status(400).json({ erro: 'A empresa exige ficha de anamnese: a ficha deste cliente não pode ser apagada.', code: CODIGO_ANAMNESE_OBRIGATORIA });
        }
      }

      // Dados cadastrais: apenas supervisores. Valores mascarados nunca sobrescrevem o dado real.
      // Nome nunca é mascarado: qualquer valor enviado conta como alteração de cadastro
      const alteraCadastro = nome !== undefined || [telefone, cpf].some((v) => v !== undefined && !valorMascarado(v))
        || (email !== undefined && email !== null);
      if (alteraCadastro && !usuarioEhSupervisor(req)) {
        return res.status(403).json({ erro: 'Apenas supervisores podem alterar nome, telefone, CPF ou e-mail do cliente.' });
      }
      if (nome !== undefined) {
        const nomeLimpo = limparTexto(nome);
        if (nomeLimpo.length < 2) return res.status(400).json({ erro: 'O nome do cliente não pode ficar vazio.' });
        // Mesma regra do cadastro (sem HTML, fórmula ou números) quando o nome muda; o atual pode ter o sufixo do totem
        const erroNome = normalizarNome(nomeLimpo) !== normalizarNome(cliente.nome) ? erroNomeCliente(nomeLimpo) : null;
        if (erroNome) return res.status(400).json({ erro: erroNome });
        dados.nome = nomeLimpo.slice(0, 120);
      }
      if (telefone !== undefined && !valorMascarado(telefone)) {
        if (telefone && !telefoneValido(telefone)) return res.status(400).json({ erro: MENSAGEM_TELEFONE_INVALIDO });
        dados.telefone = normalizarTelefone(telefone) || null;
      }
      if (cpf !== undefined && !valorMascarado(cpf)) {
        if (cpf && !cpfValido(cpf)) return res.status(400).json({ erro: MENSAGEM_CPF_INVALIDO });
        dados.cpf = apenasDigitos(cpf) || null;
      }
      if (email !== undefined && email !== null) {
        const limpo = limparTexto(email).toLowerCase();
        if (limpo && !emailValido(limpo)) return res.status(400).json({ erro: MENSAGEM_EMAIL_INVALIDO });
        dados.email = limpo || null;
      }

      const atualizado = await transacaoComTravas(async (tx) => {
        // Mesmas travas e ordem da exclusão (nome, depois cliente:id): uma ficha excluída neste instante não volta a
        // receber nome, telefone, CPF ou anamnese
        if (dados.nome) await travarNomeCliente(tx, dados.nome as string);
        await travarChave(tx, `cliente:${id}`);
        const atual = await tx.cliente.findUnique({ where: { id }, select: { removidoEm: true } });
        if (!atual || atual.removidoEm) throw new HttpError(404, 'Cliente não encontrado.');
        if (dados.nome) {
          const homonimo = await clienteComMesmoNome(tx, dados.nome as string, id);
          if (homonimo) throw new HttpError(409, mensagemNomeDuplicado(homonimo, 'carteira'));
        }
        return tx.cliente.update({ where: { id }, data: dados });
      });
      notificar();
      res.json(prepararCliente(atualizado, req, true));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar cliente');
    }
  });

  // Exclui o cliente (apenas supervisores). Atendimentos marcados impedem a exclusão. Com histórico, os dados
  // pessoais e de saúde são apagados e os atendimentos ficam (financeiro e comissões); sem histórico, apaga tudo.
  router.delete('/clientes/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const resultado = await transacaoComTravas(async (tx) => {
        const antes = await tx.cliente.findUnique({ where: { id }, select: { nome: true } });
        if (!antes) return { tipo: 'nao_encontrado' as const };
        // As mesmas travas da marcação (nome: totem e cadastro novo; cliente:id: escolhido na busca): quem marca ao
        // mesmo tempo espera e encontra o cadastro excluído, ou a exclusão espera e encontra o atendimento marcado
        await travarNomeCliente(tx, antes.nome);
        await travarChave(tx, `cliente:${id}`);
        const cliente = await tx.cliente.findUnique({ where: { id } });
        if (!cliente || cliente.removidoEm) return { tipo: 'nao_encontrado' as const };

        // Inclui o que está em andamento ou ainda não foi fechado: anonimizar no meio do atendimento apagaria a ficha
        const marcados = await tx.agendamento.findMany({
          where: { clienteId: id, status: 'scheduled' }, orderBy: { data: 'asc' }, take: 5,
          select: { data: true, colaborador: { select: { nome: true } } },
        });
        if (marcados.length > 0) return { tipo: 'com_marcados' as const, marcados };

        const historico = await tx.agendamento.count({ where: { clienteId: id } });
        if (historico === 0) {
          await tx.cliente.delete({ where: { id } });
          return { tipo: 'excluido' as const };
        }
        await tx.agendamento.updateMany({ where: { clienteId: id }, data: { observacoesSaude: null } });
        await tx.cliente.update({
          where: { id },
          data: { nome: NOME_CLIENTE_REMOVIDO, telefone: null, cpf: null, email: null, observacao: null, removidoEm: new Date() },
        });
        return { tipo: 'anonimizado' as const, historico };
      });

      if (resultado.tipo === 'nao_encontrado') return res.status(404).json({ erro: 'Cliente não encontrado. Ele pode já ter sido excluído.' });
      if (resultado.tipo === 'com_marcados') {
        return res.status(409).json({
          erro: `Este cliente ainda tem atendimento(s) em aberto: ${resultado.marcados
            .map((a) => `${formatarDataHora(a.data)} com ${a.colaborador?.nome ?? 'profissional removido'}`).join('; ')}. `
            + 'Conclua, cancele ou marque falta na agenda antes de excluir o cadastro.',
        });
      }
      notificar();
      res.json({
        mensagem: resultado.tipo === 'excluido'
          ? 'Cliente excluído com sucesso.'
          : `Dados pessoais do cliente apagados. O histórico de ${resultado.historico} atendimento(s) foi mantido sem identificação.`,
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir cliente');
    }
  });

  return router;
}
