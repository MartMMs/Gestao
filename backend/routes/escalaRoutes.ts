import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { transacaoComTravas, travarAgenda, travarChave } from '../lib/transacao';
import { dataValida, diaMesBR, horarioParaMinutos, partesNoFuso, TURNO_PADRAO, TURNO_REGEX } from '../../shared/agenda';
import { agendamentosDoDia } from '../services/agendaService';
import { aplicarAjusteEscala, folgaAcimaDoLimite, gerarEscalaComRegras, limiteFolgasPorSemana, mensagemFolgaAcimaDoLimite, segundaDaSemana, type TipoEscala as TipoContrato } from '../../shared/escala';
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
  // Turno informado e inválido (ex.: 25:00-26:00) é recusado: antes virava "trabalho sem turno" em silêncio
  const turnoInformado = valor.tipo === 'trabalho' && valor.turno !== undefined && valor.turno !== null && valor.turno !== '';
  if (turnoInformado && (typeof valor.turno !== 'string' || !TURNO_REGEX.test(valor.turno))) {
    throw new HttpError(400, 'Turno inválido. Use o formato HH:MM-HH:MM, com horas de 00 a 23.');
  }
  const turno = turnoInformado ? valor.turno as string : null;
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
  // A mesma trava da marcação: sem ela, uma marcação simultânea entraria num dia que está virando folga
  await travarAgenda(tx, colaboradorId);
  if (data < partesNoFuso(new Date()).data) {
    throw new HttpError(409, `Não é possível alterar a escala de ${data.split('-').reverse().join('/')}: a data já passou.`);
  }
  const dataBr = data.split('-').reverse().join('/');
  if (dia.tipo !== 'trabalho') {
    const marcados = await agendamentosDoDia(tx, data, { colaboradorId });
    if (marcados.length > 0) {
      throw new HttpError(409, `O profissional tem ${marcados.length} atendimento(s) em ${dataBr}. Realoque-os antes de marcar folga nesse dia.`);
    }
  } else if (dia.turno) {
    // Troca de turno: nenhum atendimento do dia pode ficar fora do novo horário (turno noturno vira a meia-noite)
    const [inicioTurno, fimTurno] = dia.turno.split('-').map(horarioParaMinutos);
    const fimEfetivo = fimTurno <= inicioTurno ? fimTurno + 24 * 60 : fimTurno;
    // Atendimento já concluído é passado: não impede mudar o turno
    const foraDoTurno = (await agendamentosDoDia(tx, data, { colaboradorId }))
      .filter((ag) => ag.status === 'scheduled')
      .filter((ag) => ag.inicioMin < inicioTurno || ag.fimMin > fimEfetivo);
    if (foraDoTurno.length > 0) {
      throw new HttpError(409, `O profissional tem ${foraDoTurno.length} atendimento(s) em ${dataBr} fora do turno ${dia.turno}. Realoque-os antes de mudar o turno.`);
    }
  }
  return gravarDia(tx, colaboradorId, data, dia);
};

const TIPOS_CONTRATO: TipoContrato[] = ['6x1', '5x2', '5x1', '12x36', 'rotativo'];

type Contrato = { id: string; tipoEscala: string | null; folgasDomingoNoMes: number | null; turnoPadrao: string | null };

// Tipo de contrato desconhecido não vira 6x1 em silêncio: sem contrato válido não há o que analisar
const contratoDe = async (tx: Prisma.TransactionClient, colaboradorId: string): Promise<Contrato | null> => {
  const c = await tx.colaborador.findUnique({ where: { id: colaboradorId }, select: { id: true, tipoEscala: true, folgasDomingoNoMes: true, turnoPadrao: true } });
  return c && TIPOS_CONTRATO.includes(c.tipoEscala as TipoContrato) ? c : null;
};

// Escala efetiva (contrato + ajustes salvos) de `de` a `ate`, a mesma da tela. Gerada desde o dia 1 do mês anterior a
// `de` e recortada: as folgas de domingo de cada mês saem iguais às da tela daquele mês
const malhaEfetiva = async (tx: Prisma.TransactionClient, c: Contrato, de: string, ate: string) => {
  const [ano, mes] = de.split('-').map(Number);
  const inicioGeracao = new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 10);
  const totalDias = Math.round((Date.parse(ate) - Date.parse(inicioGeracao)) / 86_400_000) + 1;
  const ajustes = new Map(
    (await tx.escalaOverride.findMany({ where: { colaboradorId: c.id, data: { gte: de, lte: ate } } })).map((o) => [o.data, o]),
  );
  return gerarEscalaComRegras(
    { tipo: c.tipoEscala as TipoContrato, dataInicio: inicioGeracao },
    totalDias,
    { folgasDomingoNoMes: c.folgasDomingoNoMes ?? 2, turnoPadrao: c.turnoPadrao },
  ).filter((dia) => dia.data >= de).map((dia) => aplicarAjusteEscala(dia, ajustes.get(dia.data)));
};

const somarDias = (data: string, dias: number) => new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

// Escala do mês do profissional analisada com as mesmas regras de CLT da tela, incluindo a última semana do mês
// anterior (descanso e 7º dia atravessam a virada). A API não bloqueia (a supervisão decide), mas devolve os alertas
const alertasCltDoMes = async (tx: Prisma.TransactionClient, colaboradorId: string, data: string): Promise<string[]> => {
  const c = await contratoDe(tx, colaboradorId);
  if (!c) return [];
  const [ano, mes] = data.slice(0, 7).split('-').map(Number);
  const fimDoMes = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  const analise = analisarConformidadeCLT(await malhaEfetiva(tx, c, somarDias(`${data.slice(0, 7)}-01`, -7), fimDoMes), { tipoEscala: c.tipoEscala ?? undefined });
  return analise.statusGeral ? [] : analise.resumo;
};


// Escala das semanas inteiras (segunda a domingo) das datas
const semanasDe = async (tx: Prisma.TransactionClient, c: Contrato, datas: string[]) => {
  const dias = [];
  for (const segunda of new Set(datas.map(segundaDaSemana))) dias.push(...await malhaEfetiva(tx, c, segunda, somarDias(segunda, 6)));
  return dias;
};

/**
 * Regra do 6x1 (uma folga por semana, shared/escala.ts folgaAcimaDoLimite): lida ANTES das gravações e conferida
 * DEPOIS de todas (uma troca no meio fica com duas folgas por um instante).
 */
const vigiarFolgasDaSemana = async (tx: Prisma.TransactionClient, colaboradorId: string, datas: string[]) => {
  const c = await contratoDe(tx, colaboradorId);
  const limite = limiteFolgasPorSemana(c?.tipoEscala);
  if (!c || !limite) return async () => {};
  // Trava da semana (além da do dia): duas abas marcando folga em dias diferentes da mesma semana não passam juntas
  for (const segunda of [...new Set(datas.map(segundaDaSemana))].sort()) await travarChave(tx, `escala-semana:${colaboradorId}:${segunda}`);
  const antes = await semanasDe(tx, c, datas);
  return async () => {
    const excesso = folgaAcimaDoLimite(c.tipoEscala, antes, await semanasDe(tx, c, datas));
    if (excesso) throw new HttpError(409, mensagemFolgaAcimaDoLimite(c.tipoEscala!, excesso));
  };
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

      const { salvo, alertasClt } = await transacaoComTravas(async (tx) => {
        await travarChave(tx, `escala:${chaveEscala(colaboradorId, data)}`);
        const conferirFolgas = await vigiarFolgasDaSemana(tx, colaboradorId, [data]);
        const gravado = await gravarDiaValidado(tx, colaboradorId, data, dia);
        await conferirFolgas();
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

      const resultado = await transacaoComTravas(async (tx) => {
        const chaves = [chaveEscala(from.colaboradorId, from.data), chaveEscala(to.colaboradorId, to.data)].sort();
        for (const chave of chaves) await travarChave(tx, `escala:${chave}`);

        const lerDia = async (lado: typeof from): Promise<DiaEscala> => {
          const salvo = await tx.escalaOverride.findUnique({ where: { key: chaveEscala(lado.colaboradorId, lado.data) } });
          return normalizarDia(salvo) ?? normalizarDia(lado.snapshot) ?? { tipo: 'trabalho', turno: null, descricao: null };
        };
        const diaOrigem = await lerDia(from);
        const diaDestino = await lerDia(to);

        const mesmoColaborador = from.colaboradorId === to.colaboradorId;
        const conferirOrigem = await vigiarFolgasDaSemana(tx, from.colaboradorId, mesmoColaborador ? [from.data, to.data] : [from.data]);
        const conferirDestino = mesmoColaborador ? async () => {} : await vigiarFolgasDaSemana(tx, to.colaboradorId, [to.data]);
        const gravados = {
          from: await gravarDiaValidado(tx, from.colaboradorId, from.data, diaDestino),
          to: await gravarDiaValidado(tx, to.colaboradorId, to.data, diaOrigem),
        };
        await conferirOrigem();
        await conferirDestino();
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

      const replicados = await transacaoComTravas(async (tx) => {
        // Origem e destinos, em ordem: um swap ou outra replicação no mesmo dia não sobrescreve o que esta gravou
        const chaves = [...new Set([data, ...targetDates as string[]])].map((d) => chaveEscala(colaboradorId, d)).sort();
        for (const chave of chaves) await travarChave(tx, `escala:${chave}`);
        const salvo = await tx.escalaOverride.findUnique({ where: { key: chaveEscala(colaboradorId, data) } });
        const origem = normalizarDia(salvo) ?? normalizarDia(source);
        if (!origem) throw new HttpError(404, 'Dia de origem não encontrado para replicação.');

        const conferirFolgas = await vigiarFolgasDaSemana(tx, colaboradorId, targetDates);
        const criados = [];
        for (const alvo of new Set<string>(targetDates)) criados.push(await gravarDiaValidado(tx, colaboradorId, alvo, origem));
        await conferirFolgas();
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
      const troca = await transacaoComTravas(async (tx) => {
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

      const troca = await transacaoComTravas(async (tx) => {
        // Aprovar e rejeitar ao mesmo tempo: o segundo espera e encontra a solicitação já respondida
        await travarChave(tx, `troca-resposta:${req.params.id}`);
        const atual = await tx.solicitacaoTroca.findUnique({ where: { id: req.params.id } });
        if (!atual) throw new HttpError(404, 'Solicitação não encontrada.');
        if (atual.status !== 'pendente') throw new HttpError(409, 'Esta solicitação já foi respondida.');
        // Os dois dias que a aprovação grava, em ordem (como no swap), antes da trava da agenda
        if (status === 'aprovada') {
          const chaves = [atual.dataOriginal, atual.dataSolicitada].map((d) => chaveEscala(atual.colaboradorId, d)).sort();
          for (const chave of chaves) await travarChave(tx, `escala:${chave}`);
        }
        // Aprovar depois das datas reescreveria a escala retroativamente; rejeitar continua permitido
        if (status === 'aprovada') {
          const hoje = partesNoFuso(new Date()).data;
          if (atual.dataOriginal < hoje || atual.dataSolicitada < hoje) {
            throw new HttpError(409, 'As datas desta solicitação já passaram. Rejeite-a e peça uma nova, se ainda for necessário.');
          }
        }

        if (status === 'aprovada') {
          // O dia original vira folga: não pode haver atendimentos marcados nele
          await travarAgenda(tx, atual.colaboradorId);
          const marcados = await agendamentosDoDia(tx, atual.dataOriginal, { colaboradorId: atual.colaboradorId });
          if (marcados.length > 0) {
            throw new HttpError(409, `O colaborador tem ${marcados.length} atendimento(s) em ${atual.dataOriginal.split('-').reverse().join('/')}. Realoque-os antes de aprovar a troca.`);
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
          await gravarDiaValidado(tx, atual.colaboradorId, atual.dataSolicitada, { tipo: 'trabalho', turno, descricao: 'Turno de compensação' });
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
