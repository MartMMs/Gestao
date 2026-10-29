import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { transacaoSerializavel, travarChave } from '../lib/transacao';
import { dataValida, partesNoFuso, TURNO_PADRAO, TURNO_REGEX } from '../../shared/agenda';
import { agendamentosDoDia } from '../services/agendaService';
import { gerarEscalaComRegras, type DiaEscala as DiaCalculado, type TipoEscala as TipoContrato } from '../../shared/escala';
import { analisarConformidadeCLT } from '../../shared/clt';

type TipoEscala = 'trabalho' | 'folga' | 'fds';
type DiaEscala = { tipo: TipoEscala; turno: string | null; descricao: string | null };

const STATUS_TROCA = ['pendente', 'aprovada', 'rejeitada'] as const;
const MAX_DATAS_REPLICACAO = 62;

const normalizarTipo = (valor: unknown): TipoEscala =>
  valor === 'folga' || valor === 'fds' ? valor : 'trabalho';

// Normaliza um dia de escala vindo do cliente; turno só existe em dia de trabalho
const normalizarDia = (entrada: unknown): DiaEscala | null => {
  if (!entrada || typeof entrada !== 'object') return null;
  const valor = entrada as Record<string, unknown>;
  if (valor.tipo !== 'trabalho' && valor.tipo !== 'folga' && valor.tipo !== 'fds') return null;
  const turno = valor.tipo === 'trabalho' && typeof valor.turno === 'string' && TURNO_REGEX.test(valor.turno) ? valor.turno : null;
  return { tipo: valor.tipo, turno, descricao: typeof valor.descricao === 'string' ? valor.descricao.slice(0, 200) : null };
};

const chaveEscala = (colaboradorId: string, data: string) => `${colaboradorId}:${data}`;

const gravarDia = (tx: Prisma.TransactionClient, colaboradorId: string, data: string, dia: DiaEscala) =>
  tx.escalaOverride.upsert({
    where: { key: chaveEscala(colaboradorId, data) },
    create: { key: chaveEscala(colaboradorId, data), colaboradorId, data, ...dia },
    update: dia,
  });

// Mesmas regras da troca de turno aprovada: dias passados não mudam (a escala vira registro do que aconteceu) e
// um dia com atendimentos marcados não pode virar folga sem que eles sejam realocados antes.
const gravarDiaValidado = async (tx: Prisma.TransactionClient, colaboradorId: string, data: string, dia: DiaEscala) => {
  if (data < partesNoFuso(new Date()).data) {
    throw new HttpError(409, `Não é possível alterar a escala de ${data}: a data já passou.`);
  }
  if (dia.tipo !== 'trabalho') {
    const marcados = await agendamentosDoDia(tx, data, { colaboradorId });
    if (marcados.length > 0) {
      throw new HttpError(409, `O profissional tem ${marcados.length} atendimento(s) em ${data}. Realoque-os antes de marcar folga nesse dia.`);
    }
  }
  return gravarDia(tx, colaboradorId, data, dia);
};

const TIPOS_CONTRATO: TipoContrato[] = ['6x1', '5x2', '5x1', '12x36', 'rotativo'];

// Escala do mês do profissional (contrato + ajustes salvos) analisada com as mesmas regras de CLT da tela.
// A API não bloqueia (a supervisão decide), mas devolve os alertas: a regra não depende mais só do frontend.
const alertasCltDoMes = async (tx: Prisma.TransactionClient, colaboradorId: string, data: string): Promise<string[]> => {
  const colaborador = await tx.colaborador.findUnique({ where: { id: colaboradorId } });
  if (!colaborador) return [];
  const mes = data.slice(0, 7);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const tipo = TIPOS_CONTRATO.includes(colaborador.tipoEscala as TipoContrato) ? (colaborador.tipoEscala as TipoContrato) : '6x1';
  const base = gerarEscalaComRegras(
    { tipo, dataInicio: `${mes}-01` },
    new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate(),
    { folgasDomingoNoMes: colaborador.folgasDomingoNoMes ?? 2 },
  );
  const ajustes = new Map(
    (await tx.escalaOverride.findMany({ where: { colaboradorId, data: { startsWith: `${mes}-` } } })).map((o) => [o.data, o]),
  );
  const dias: DiaCalculado[] = base.map((dia) => {
    const ajuste = ajustes.get(dia.data);
    if (!ajuste) return dia;
    const tipoDia = normalizarTipo(ajuste.tipo);
    if (tipoDia !== 'trabalho') return { ...dia, tipo: tipoDia, turno: undefined, horaInicio: undefined, horaFim: undefined, descricao: ajuste.descricao ?? dia.descricao };
    const [horaInicio, horaFim] = (ajuste.turno ?? '').split('-');
    return { ...dia, tipo: 'trabalho', turno: ajuste.turno ?? dia.turno, horaInicio: horaInicio || dia.horaInicio, horaFim: horaFim || dia.horaFim };
  });
  const analise = analisarConformidadeCLT(dias);
  return analise.statusGeral ? [] : analise.resumo;
};

const garantirColaborador = async (colaboradorId: unknown) => {
  if (typeof colaboradorId !== 'string' || !(await prisma.colaborador.findUnique({ where: { id: colaboradorId } }))) {
    throw new HttpError(400, 'Profissional não encontrado.');
  }
  return colaboradorId;
};

export function createEscalaRouter(notificar: Notificar) {
  const router = Router();

  router.get('/escala/overrides', verificarSupervisorToken, async (req, res) => {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : null;
      const colaboradorId = typeof req.query.colaboradorId === 'string' ? req.query.colaboradorId : null;
      const rows = await prisma.escalaOverride.findMany({
        where: {
          ...(colaboradorId ? { colaboradorId } : {}),
          ...(month ? { data: { startsWith: `${month}-` } } : {}),
        },
        orderBy: { data: 'asc' },
      });
      res.json(rows);
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar a escala');
    }
  });

  router.post('/escala/override', verificarSupervisorToken, async (req, res) => {
    try {
      const colaboradorId = await garantirColaborador(req.body.colaboradorId);
      const { data } = req.body;
      if (!dataValida(data)) return res.status(400).json({ erro: 'Data inválida.' });
      const tipo = normalizarTipo(req.body.tipo);
      const dia = normalizarDia({ tipo, turno: req.body.turno, descricao: req.body.descricao })!;

      const { salvo, alertasClt } = await transacaoSerializavel(async (tx) => {
        await travarChave(tx, `escala:${chaveEscala(colaboradorId, data)}`);
        const gravado = await gravarDiaValidado(tx, colaboradorId, data, dia);
        return { salvo: gravado, alertasClt: await alertasCltDoMes(tx, colaboradorId, data) };
      });
      notificar();
      res.json({ ...salvo, alertasClt });
    } catch (error) {
      responderErro(res, error, 'Erro ao salvar a escala');
    }
  });

  // Troca os dias de escala entre dois profissionais/datas.
  // `snapshot` informa o dia calculado pelo front quando ainda não há registro salvo.
  router.post('/escala/swap', verificarSupervisorToken, async (req, res) => {
    try {
      const { from, to } = req.body ?? {};
      if (!from || !to || !dataValida(from.data) || !dataValida(to.data)) {
        return res.status(400).json({ erro: 'Informe origem e destino da troca ({ colaboradorId, data }).' });
      }
      await garantirColaborador(from.colaboradorId);
      await garantirColaborador(to.colaboradorId);

      const resultado = await transacaoSerializavel(async (tx) => {
        const chaves = [chaveEscala(from.colaboradorId, from.data), chaveEscala(to.colaboradorId, to.data)].sort();
        for (const chave of chaves) await travarChave(tx, `escala:${chave}`);

        const lerDia = async (lado: typeof from): Promise<DiaEscala> => {
          const salvo = await tx.escalaOverride.findUnique({ where: { key: chaveEscala(lado.colaboradorId, lado.data) } });
          return normalizarDia(salvo) ?? normalizarDia(lado.snapshot) ?? { tipo: 'trabalho', turno: null, descricao: null };
        };
        const diaOrigem = await lerDia(from);
        const diaDestino = await lerDia(to);

        const gravados = {
          from: await gravarDiaValidado(tx, from.colaboradorId, from.data, diaDestino),
          to: await gravarDiaValidado(tx, to.colaboradorId, to.data, diaOrigem),
        };
        const alertasClt = [
          ...await alertasCltDoMes(tx, from.colaboradorId, from.data),
          ...(to.colaboradorId !== from.colaboradorId || to.data.slice(0, 7) !== from.data.slice(0, 7)
            ? await alertasCltDoMes(tx, to.colaboradorId, to.data) : []),
        ];
        return { ...gravados, alertasClt };
      });
      notificar();
      res.json(resultado);
    } catch (error) {
      responderErro(res, error, 'Erro ao executar troca de escala');
    }
  });

  router.post('/escala/replicate', verificarSupervisorToken, async (req, res) => {
    try {
      const colaboradorId = await garantirColaborador(req.body.colaboradorId);
      const { data, targetDates, source } = req.body;
      if (!dataValida(data) || !Array.isArray(targetDates) || targetDates.length === 0
        || targetDates.length > MAX_DATAS_REPLICACAO || !targetDates.every(dataValida)) {
        return res.status(400).json({ erro: `Informe a data de origem e até ${MAX_DATAS_REPLICACAO} datas de destino válidas.` });
      }

      const replicados = await transacaoSerializavel(async (tx) => {
        await travarChave(tx, `escala:${chaveEscala(colaboradorId, data)}`);
        const salvo = await tx.escalaOverride.findUnique({ where: { key: chaveEscala(colaboradorId, data) } });
        const origem = normalizarDia(salvo) ?? normalizarDia(source);
        if (!origem) throw new HttpError(404, 'Dia de origem não encontrado para replicação.');

        const criados = [];
        for (const alvo of new Set<string>(targetDates)) criados.push(await gravarDiaValidado(tx, colaboradorId, alvo, origem));
        const meses = [...new Set<string>(targetDates.map((alvo: string) => alvo.slice(0, 7)))];
        const alertasClt: string[] = [];
        for (const mes of meses) alertasClt.push(...await alertasCltDoMes(tx, colaboradorId, `${mes}-01`));
        return { criados, alertasClt };
      });
      notificar();
      res.json({ replicated: replicados.criados, alertasClt: replicados.alertasClt });
    } catch (error) {
      responderErro(res, error, 'Erro ao replicar escala');
    }
  });

  // ---- Trocas de turno (Portal do Colaborador -> Supervisor) ----
  router.get('/trocas-turno', verificarToken, async (req, res) => {
    try {
      const trocas = await prisma.solicitacaoTroca.findMany({
        where: usuarioEhSupervisor(req) ? {} : { colaboradorId: getUsuario(req)?.id },
        include: { colaborador: { select: { nome: true } } },
        orderBy: { criadoEm: 'desc' },
      });
      res.json(trocas.map(({ colaborador, ...troca }) => ({ ...troca, colaboradorNome: colaborador.nome })));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar solicitações de troca');
    }
  });

  // Colaborador solicita troca para si mesmo; o pedido sempre nasce pendente
  router.post('/trocas-turno', verificarToken, async (req, res) => {
    try {
      const usuario = getUsuario(req)!;
      const colaboradorId = usuarioEhSupervisor(req) && typeof req.body.colaboradorId === 'string'
        ? req.body.colaboradorId
        : usuario.id;
      await garantirColaborador(colaboradorId);

      const { dataOriginal, dataSolicitada } = req.body;
      if (!dataValida(dataOriginal) || !dataValida(dataSolicitada) || dataOriginal === dataSolicitada) {
        return res.status(400).json({ erro: 'Informe datas válidas e diferentes para a troca.' });
      }
      const hoje = partesNoFuso(new Date()).data;
      if (dataOriginal < hoje || dataSolicitada < hoje) {
        return res.status(400).json({ erro: 'Não é possível solicitar troca para datas que já passaram.' });
      }
      const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim().slice(0, 500) : '';
      if (!motivo) return res.status(400).json({ erro: 'Informe o motivo da troca.' });

      // A trava por colaborador impede que dois envios simultâneos (duas abas, nova tentativa da rede) dupliquem o pedido
      const troca = await transacaoSerializavel(async (tx) => {
        await travarChave(tx, `troca:${colaboradorId}`);
        const pendenteIgual = await tx.solicitacaoTroca.findFirst({
          where: { colaboradorId, dataOriginal, dataSolicitada, status: 'pendente' },
        });
        if (pendenteIgual) throw new HttpError(409, 'Já existe uma solicitação pendente para essas datas.');
        return tx.solicitacaoTroca.create({
          data: { colaboradorId, dataOriginal, dataSolicitada, motivo, status: 'pendente' },
        });
      });
      notificar();
      res.status(201).json(troca);
    } catch (error) {
      responderErro(res, error, 'Erro ao criar solicitação de troca');
    }
  });

  // Aprovar uma troca ajusta a escala na mesma transação: o dia original vira folga e o solicitado, trabalho
  router.patch('/trocas-turno/:id/status', verificarSupervisorToken, async (req, res) => {
    try {
      const { status } = req.body;
      if (status !== 'aprovada' && status !== 'rejeitada') {
        return res.status(400).json({ erro: `Status inválido. Use: ${STATUS_TROCA.filter((s) => s !== 'pendente').join(' ou ')}.` });
      }
      const respostaObservacao = typeof req.body.respostaObservacao === 'string' ? req.body.respostaObservacao.slice(0, 500) : null;

      const troca = await transacaoSerializavel(async (tx) => {
        const atual = await tx.solicitacaoTroca.findUnique({ where: { id: req.params.id } });
        if (!atual) throw new HttpError(404, 'Solicitação não encontrada.');
        if (atual.status !== 'pendente') throw new HttpError(409, 'Esta solicitação já foi respondida.');
        // Aprovar depois das datas reescreveria a escala retroativamente; rejeitar continua permitido
        if (status === 'aprovada') {
          const hoje = partesNoFuso(new Date()).data;
          if (atual.dataOriginal < hoje || atual.dataSolicitada < hoje) {
            throw new HttpError(409, 'As datas desta solicitação já passaram. Rejeite-a e peça uma nova, se ainda for necessário.');
          }
        }

        if (status === 'aprovada') {
          // O dia original vira folga: não pode haver atendimentos marcados nele
          const marcados = await agendamentosDoDia(tx, atual.dataOriginal, { colaboradorId: atual.colaboradorId });
          if (marcados.length > 0) {
            throw new HttpError(409, `O colaborador tem ${marcados.length} atendimento(s) em ${atual.dataOriginal}. Realoque-os antes de aprovar a troca.`);
          }
        }

        const atualizada = await tx.solicitacaoTroca.update({
          where: { id: atual.id },
          data: { status, respostaObservacao, respondidoPorId: getUsuario(req)?.id ?? null },
        });

        if (status === 'aprovada') {
          const original = await tx.escalaOverride.findUnique({ where: { key: chaveEscala(atual.colaboradorId, atual.dataOriginal) } });
          const turno = original?.tipo === 'trabalho' && original.turno ? original.turno : TURNO_PADRAO;
          await gravarDia(tx, atual.colaboradorId, atual.dataOriginal, { tipo: 'folga', turno: null, descricao: 'Troca de turno aprovada' });
          await gravarDia(tx, atual.colaboradorId, atual.dataSolicitada, { tipo: 'trabalho', turno, descricao: 'Turno de compensação' });
        }
        return atualizada;
      });

      notificar();
      res.json(troca);
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar solicitação de troca');
    }
  });

  return router;
}
