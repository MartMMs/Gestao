import { Router } from 'express';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { transacaoComTravas, travarChave } from '../lib/transacao';
import { registrarAuditoria } from '../lib/auditoria';
import { clientesComAcessoSaude } from '../lib/privacidade';
import { getEmpresaConfig } from '../services/configService';
import { lerCampos, listarCampos, TRAVA_FORMULARIO } from '../services/formularioService';
import {
  alertasDe, assinaturaEstrutural, camposDoCanal, formularioPublico, lerRespostas, lerSnapshot, montarSnapshot,
  presetDoSegmento, validarCampos, type CampoFormulario,
} from '../../shared/formularioAnamnese';
import { CODIGO_CONFIG_DESATUALIZADA } from '../../shared/codigosErro';

// Resumo legível do formulário para o histórico de alterações (só rótulos: o formulário não tem dado de cliente)
const resumoAuditoria = (campos: CampoFormulario[], versao: number) => ({
  versao,
  ativos: camposDoCanal(campos, 'totem').concat(camposDoCanal(campos, 'profissional'))
    .filter((c, i, todos) => todos.findIndex((x) => x.id === c.id) === i).map((c) => c.rotulo),
  arquivados: campos.filter((c) => !c.ativa).map((c) => c.rotulo),
});

export function createFormularioRouter(notificar: Notificar) {
  const router = Router();

  // Gestão: todos os campos (ativos e arquivados), só admin e supervisão
  router.get('/formulario-anamnese', verificarSupervisorToken, async (_req, res) => {
    try {
      const { campos, versao } = await listarCampos();
      res.json({ campos, versao, segmento: (await getEmpresaConfig()).segmento });
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar o formulário de anamnese.');
    }
  });

  // Equipe interna: campos "ambos" e "apenas_profissional" ativos (a ficha do cliente segue as regras de acesso de saúde)
  router.get('/formulario-anamnese/equipe', verificarToken, async (_req, res) => {
    try {
      const { campos, versao } = await listarCampos();
      res.json({ campos: camposDoCanal(campos, 'profissional'), versao });
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar o formulário de anamnese.');
    }
  });

  // Recepção (ficha às cegas no balcão): mesmos campos e mesma lista branca do totem, sem respostasAlerta nem canal
  router.get('/formulario-anamnese/recepcao', verificarToken, async (req, res) => {
    try {
      if (!usuarioGerenciaAgenda(req)) return res.status(403).json({ erro: 'Disponível só para a recepção e a supervisão.' });
      const { campos } = await listarCampos();
      res.json({ campos: formularioPublico(campos).campos });
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar o formulário de anamnese.');
    }
  });

  router.put('/formulario-anamnese', verificarSupervisorToken, async (req, res) => {
    try {
      const { campos: enviados, erro } = validarCampos(req.body?.campos);
      if (erro) return res.status(400).json({ erro });
      await listarCampos(); // garante a criação inicial antes de comparar versões
      const resultado = await transacaoComTravas(async (tx) => {
        await travarChave(tx, TRAVA_FORMULARIO);
        const antes = await lerCampos(tx);
        if (req.body?.versao !== antes.versao) {
          throw new HttpError(409, 'Outra pessoa alterou o formulário enquanto você editava. Feche e abra de novo para ver a versão atual.', CODIGO_CONFIG_DESATUALIZADA);
        }
        const porId = new Map(antes.campos.map((c) => [c.id, c]));
        const nova = antes.versao + 1;
        let mudou = false;
        for (const campo of enviados) {
          const existente = campo.id ? porId.get(campo.id) : undefined;
          if (campo.id && !existente) throw new HttpError(409, `O campo "${campo.rotulo}" não existe mais. Feche e abra o editor de novo.`);
          // A chave de um campo existente não muda: é o que liga as respostas antigas à pergunta
          const dados = { ...campo, chave: existente?.chave ?? campo.chave };
          const { id: _id, ...semId } = dados;
          const dono = antes.campos.find((c) => c.chave === dados.chave);
          if (dono && dono.id !== existente?.id) throw new HttpError(409, `Já existe um campo com a chave "${dados.chave}" (talvez arquivado). Reative-o ou mude o rótulo.`);
          if (!existente) {
            await tx.campoFormulario.create({ data: { ...semId, versao: nova } });
            mudou = true;
          } else if (assinaturaEstrutural(existente) !== assinaturaEstrutural(semId)) {
            await tx.campoFormulario.update({ where: { id: existente.id }, data: { ...semId, versao: nova } });
            mudou = true;
          }
        }
        if (!mudou) return { antes, depois: antes };
        await tx.configuracaoEmpresa.update({ where: { id: 'default' }, data: { formularioVersao: nova } });
        const depois = await lerCampos(tx);
        await registrarAuditoria(req, {
          acao: 'formulario.anamnese', alvo: 'Formulário de anamnese',
          antes: resumoAuditoria(antes.campos, antes.versao), depois: resumoAuditoria(depois.campos, depois.versao), tx,
        });
        return { antes, depois };
      });
      notificar();
      res.json(resultado.depois);
    } catch (error) {
      responderErro(res, error, 'Erro ao salvar o formulário de anamnese.');
    }
  });

  // Modelo do segmento: sem "aplicar", só mostra; com "aplicar", arquiva os ativos e ativa os do modelo
  router.post('/formulario-anamnese/preset', verificarSupervisorToken, async (req, res) => {
    try {
      const segmento = typeof req.body?.segmento === 'string' ? req.body.segmento : (await getEmpresaConfig()).segmento;
      const preset = presetDoSegmento(segmento);
      if (req.body?.aplicar !== true) return res.json({ segmento, campos: preset });
      await listarCampos();
      const depois = await transacaoComTravas(async (tx) => {
        await travarChave(tx, TRAVA_FORMULARIO);
        const antes = await lerCampos(tx);
        const nova = antes.versao + 1;
        // Arquiva, nunca apaga: as fichas antigas guardam a própria cópia das perguntas
        await tx.campoFormulario.updateMany({ where: { ativa: true }, data: { ativa: false, versao: nova } });
        for (const [ordem, campo] of preset.entries()) {
          await tx.campoFormulario.upsert({
            where: { chave: campo.chave },
            update: { ...campo, ordem, ativa: true, versao: nova },
            create: { ...campo, ordem, ativa: true, versao: nova },
          });
        }
        await tx.configuracaoEmpresa.update({ where: { id: 'default' }, data: { formularioVersao: nova } });
        const resultado = await lerCampos(tx);
        await registrarAuditoria(req, {
          acao: 'formulario.preset', alvo: `Modelo do segmento (${segmento})`,
          antes: resumoAuditoria(antes.campos, antes.versao), depois: resumoAuditoria(resultado.campos, resultado.versao), tx,
        });
        return resultado;
      });
      notificar();
      res.json(depois);
    } catch (error) {
      responderErro(res, error, 'Erro ao carregar o modelo do segmento.');
    }
  });

  // Mesma regra do PUT /clientes/:id: supervisão ou o profissional que atende o cliente
  const veSaudeDoCliente = async (req: Parameters<typeof usuarioEhSupervisor>[0], clienteId: string) =>
    usuarioEhSupervisor(req) || (await clientesComAcessoSaude(req)).has(clienteId);

  router.get('/clientes/:id/fichas', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!(await veSaudeDoCliente(req, id))) return res.status(403).json({ erro: 'A ficha é visível só para a supervisão e para o profissional do atendimento.' });
      const fichas = await prisma.fichaPreenchida.findMany({
        where: { clienteId: id, vinculadaAoCliente: true }, orderBy: { preenchidoEm: 'desc' }, take: 50,
      });
      res.json(fichas.map((f) => ({ id: f.id, canal: f.canal, preenchidoEm: f.preenchidoEm, alertas: f.alertas, snapshot: lerSnapshot(f.snapshot) })));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar as fichas do cliente.');
    }
  });

  router.post('/clientes/:id/fichas', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!(await veSaudeDoCliente(req, id))) return res.status(403).json({ erro: 'Você só pode registrar anamnese de clientes que atende.' });
      const { campos, versao } = await listarCampos();
      const { itens, erro } = lerRespostas(campos, req.body?.respostas, 'profissional');
      if (erro) return res.status(400).json({ erro });
      if (itens.length === 0) return res.status(400).json({ erro: 'Responda ao menos uma pergunta da ficha.' });
      const snapshot = montarSnapshot(itens, versao, 'profissional');
      const ficha = await transacaoComTravas(async (tx) => {
        await travarChave(tx, `cliente:${id}`);
        const cliente = await tx.cliente.findUnique({ where: { id } });
        if (!cliente || cliente.removidoEm) throw new HttpError(404, 'Cliente não encontrado.');
        const criada = await tx.fichaPreenchida.create({
          data: {
            clienteId: id, canal: 'profissional', versaoFormulario: versao, snapshot, alertas: alertasDe(itens),
            preenchidoPorId: getUsuario(req)?.id ?? null,
          },
        });
        // Só o fato (sem as respostas): o histórico de alterações não guarda dado de saúde
        await registrarAuditoria(req, {
          acao: 'cliente.anamnese', alvo: cliente.nome, antes: { fichaFormulario: null }, depois: { fichaFormulario: `versão ${versao}` }, tx,
        });
        return criada;
      });
      notificar();
      res.status(201).json({ id: ficha.id, canal: ficha.canal, preenchidoEm: ficha.preenchidoEm, alertas: ficha.alertas, snapshot });
    } catch (error) {
      responderErro(res, error, 'Erro ao salvar a ficha do cliente.');
    }
  });

  // Recepção grava às cegas: só perguntas do totem/ambos, alerta calculado aqui, resposta sem nenhum dado de saúde
  router.post('/clientes/:id/fichas/recepcao', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!usuarioGerenciaAgenda(req)) return res.status(403).json({ erro: 'Disponível só para a recepção e a supervisão.' });
      const { campos, versao } = await listarCampos();
      const { itens, erro } = lerRespostas(campos, req.body?.respostas, 'totem');
      if (erro) return res.status(400).json({ erro });
      if (itens.length === 0) return res.status(400).json({ erro: 'Responda ao menos uma pergunta da ficha.' });
      const snapshot = montarSnapshot(itens, versao, 'totem');
      const ficha = await transacaoComTravas(async (tx) => {
        await travarChave(tx, `cliente:${id}`);
        const cliente = await tx.cliente.findUnique({ where: { id } });
        if (!cliente || cliente.removidoEm) throw new HttpError(404, 'Cliente não encontrado.');
        const criada = await tx.fichaPreenchida.create({
          data: { clienteId: id, canal: 'recepcao', versaoFormulario: versao, snapshot, alertas: alertasDe(itens), preenchidoPorId: getUsuario(req)?.id ?? null },
        });
        await registrarAuditoria(req, {
          acao: 'cliente.anamnese', alvo: cliente.nome, antes: { fichaFormulario: null }, depois: { fichaFormulario: `versão ${versao} (recepção)` }, tx,
        });
        return criada;
      });
      notificar();
      res.status(201).json({ id: ficha.id, preenchidoEm: ficha.preenchidoEm });
    } catch (error) {
      responderErro(res, error, 'Erro ao salvar a ficha do cliente.');
    }
  });

  return router;
}
