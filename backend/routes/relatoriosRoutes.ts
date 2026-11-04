import { Router } from 'express';
import { prisma } from '../db';
import { usuarioEhAdmin, verificarSupervisorToken } from '../auth';
import { HttpError, responderErro } from '../lib/http';
import { getEmpresaConfig } from '../services/configService';
import { centavos as arredondar, valoresGravados } from '../lib/valores';
import { dataValida, instanteNoFuso, partesNoFuso } from '../../shared/agenda';
import { STATUS_FECHADOS, semBaixaVencido, statusFechado } from '../../shared/statusAgendamento';

const MAX_DIAS_RELATORIO = 366;

type LinhaProfissional = {
  colaboradorId: string;
  nome: string;
  ativo: boolean;
  concluidos: number;
  faturamento: number;
  comissao: number;
  ticketMedio: number;
  faltas: number;
  // Agendados cujo horário passou sem baixa: separados das faltas confirmadas (a recepção ainda pode corrigir)
  semBaixa: number;
  cancelados: number;
};

// Além dos fechados, os ainda "agendados" que já começaram: a falta só vira no_show bem depois (limpeza).
// Os que ainda não terminaram são descartados com `semBaixaVencido` (shared/statusAgendamento.ts).
const filtroStatusRelatorio = (agora: Date) => [
  { status: { in: [...STATUS_FECHADOS] } },
  { status: 'scheduled', data: { lt: agora } },
  { status: null, data: { lt: agora } },
];
const SELECT_DURACAO = { duracao: true, tempoHigienizacaoMin: true } as const;
const semBaixa = (ag: { status: string | null; data: Date; servicos: { duracao: number | null; tempoHigienizacaoMin: number | null }[] }, agora: Date) =>
  semBaixaVencido({ status: ag.status, inicio: ag.data, servicos: ag.servicos }, agora);

// Período fechado [de, ate] em datas do negócio (AAAA-MM-DD); padrão: mês atual até hoje
const lerPeriodo = (de: unknown, ate: unknown) => {
  const hoje = partesNoFuso(new Date()).data;
  const inicio = de === undefined ? `${hoje.slice(0, 7)}-01` : de;
  const fim = ate === undefined ? hoje : ate;
  if (!dataValida(inicio) || !dataValida(fim)) throw new HttpError(400, 'Período inválido. Use datas no formato AAAA-MM-DD.');
  if (inicio > fim) throw new HttpError(400, 'A data inicial deve ser anterior ou igual à final.');
  const dias = (Date.parse(fim) - Date.parse(inicio)) / 86_400_000 + 1;
  if (dias > MAX_DIAS_RELATORIO) throw new HttpError(400, `O período pode ter no máximo ${MAX_DIAS_RELATORIO} dias.`);
  return { inicio, fim };
};

const LIMITE_DETALHE = 2000;

// Atendimentos do período que entram no relatório (mesma consulta no agregado e no detalhe)
const buscarDoPeriodo = (inicio: string, fim: string, agora: Date, filtroExtra: { colaboradorId?: string } = {}, take?: number) => {
  // O dia seguinte ao fim, à meia-noite no fuso do negócio, fecha o intervalo
  const depoisDoFim = new Date(Date.parse(`${fim}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return prisma.agendamento.findMany({
    where: {
      ...filtroExtra,
      data: { gte: instanteNoFuso(inicio, '00:00'), lt: instanteNoFuso(depoisDoFim, '00:00') },
      OR: filtroStatusRelatorio(agora),
    },
    orderBy: { data: 'asc' },
    ...(take ? { take } : {}),
    select: {
      id: true, status: true, data: true, valorTotal: true, valorComissao: true, colaboradorId: true,
      colaborador: { select: { nome: true, ativo: true } },
      cliente: { select: { nome: true, codigo: true } },
      servicos: { select: { id: true, nome: true, preco: true, comissaoPercentual: true, ...SELECT_DURACAO } },
    },
  });
};
type AtendimentoDoPeriodo = Awaited<ReturnType<typeof buscarDoPeriodo>>[number];

// Como o atendimento entra no relatório: só concluído soma valor e comissão (valoresGravados, a regra única)
const classificar = (ag: AtendimentoDoPeriodo, agora: Date, usarComissao: boolean) => {
  if (semBaixa(ag, agora)) return { tipo: 'sem_baixa' as const, valor: 0, comissao: 0 };
  if (!statusFechado(ag.status)) return null; // ainda em andamento
  if (ag.status !== 'completed') return { tipo: ag.status as 'no_show' | 'cancelled', valor: 0, comissao: 0 };
  const { valor, comissao } = valoresGravados(ag);
  return { tipo: 'completed' as const, valor, comissao: usarComissao ? comissao : 0 };
};

export function createRelatoriosRouter() {
  const router = Router();

  /**
   * Relatório financeiro (supervisão e administração): faturamento e comissão por profissional e por serviço.
   * Usa os valores gravados em cada atendimento, então mudar preço ou comissão de um serviço não altera o passado.
   */
  router.get('/relatorios/financeiro', verificarSupervisorToken, async (req, res) => {
    try {
      const { inicio, fim } = lerPeriodo(req.query.de, req.query.ate);
      const usarComissao = (await getEmpresaConfig()).usarComissao !== false;
      const agora = new Date();
      const agendamentos = await buscarDoPeriodo(inicio, fim, agora);

      const porProfissional = new Map<string, LinhaProfissional>();
      const porServico = new Map<string, { nome: string; quantidade: number; faturamento: number }>();
      for (const ag of agendamentos) {
        const item = classificar(ag, agora, usarComissao);
        if (!item) continue;
        const linha = porProfissional.get(ag.colaboradorId) ?? {
          colaboradorId: ag.colaboradorId, nome: ag.colaborador.nome, ativo: ag.colaborador.ativo,
          concluidos: 0, faturamento: 0, comissao: 0, ticketMedio: 0, faltas: 0, semBaixa: 0, cancelados: 0,
        };
        if (item.tipo === 'sem_baixa') linha.semBaixa += 1;
        else if (item.tipo === 'no_show') linha.faltas += 1;
        else if (item.tipo === 'cancelled') linha.cancelados += 1;
        else {
          linha.concluidos += 1;
          linha.faturamento += item.valor;
          linha.comissao += item.comissao;
          // Valor de cada serviço proporcional ao total gravado (o preço pode ter mudado depois)
          const somaPrecos = ag.servicos.reduce((soma, s) => soma + s.preco, 0);
          for (const s of ag.servicos) {
            const porItem = porServico.get(s.id) ?? { nome: s.nome, quantidade: 0, faturamento: 0 };
            porItem.quantidade += 1;
            porItem.faturamento += somaPrecos > 0 ? item.valor * (s.preco / somaPrecos) : item.valor / ag.servicos.length;
            porServico.set(s.id, porItem);
          }
        }
        porProfissional.set(ag.colaboradorId, linha);
      }

      const profissionais = [...porProfissional.values()]
        .map((l) => ({
          ...l,
          faturamento: arredondar(l.faturamento),
          comissao: arredondar(l.comissao),
          ticketMedio: l.concluidos > 0 ? arredondar(l.faturamento / l.concluidos) : 0,
        }))
        .sort((a, b) => b.faturamento - a.faturamento);
      const servicos = [...porServico.values()]
        .map((s) => ({ ...s, faturamento: arredondar(s.faturamento) }))
        .sort((a, b) => b.faturamento - a.faturamento);
      const soma = (campo: 'concluidos' | 'faturamento' | 'comissao' | 'faltas' | 'semBaixa' | 'cancelados') =>
        profissionais.reduce((total, l) => total + l[campo], 0);

      res.json({
        periodo: { de: inicio, ate: fim },
        usarComissao,
        totais: {
          concluidos: soma('concluidos'),
          faturamento: arredondar(soma('faturamento')),
          comissao: arredondar(soma('comissao')),
          liquido: arredondar(soma('faturamento') - soma('comissao')),
          faltas: soma('faltas'),
          semBaixa: soma('semBaixa'),
          cancelados: soma('cancelados'),
        },
        profissionais,
        servicos,
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao gerar o relatório financeiro');
    }
  });

  // Atendimentos de um profissional no período (conferência do fechamento e da comissão)
  router.get('/relatorios/financeiro/atendimentos', verificarSupervisorToken, async (req, res) => {
    try {
      const { inicio, fim } = lerPeriodo(req.query.de, req.query.ate);
      const colaboradorId = req.query.colaboradorId;
      if (typeof colaboradorId !== 'string' || !/^[0-9a-f-]{36}$/i.test(colaboradorId)) throw new HttpError(400, 'Informe o profissional.');
      const usarComissao = (await getEmpresaConfig()).usarComissao !== false;
      const agora = new Date();
      // Um a mais que o limite: assim dá para avisar que a lista foi cortada (e não somar menos sem dizer)
      const agendamentos = await buscarDoPeriodo(inicio, fim, agora, { colaboradorId }, LIMITE_DETALHE + 1);
      const atendimentos = agendamentos.slice(0, LIMITE_DETALHE).flatMap((ag) => {
        const item = classificar(ag, agora, usarComissao);
        if (!item) return [];
        const { data, horario } = partesNoFuso(ag.data);
        return [{
          id: ag.id,
          data,
          horario,
          // Sem baixa aparece com rótulo próprio: a recepção ainda pode concluir ou marcar a falta
          status: item.tipo,
          cliente: ag.cliente.nome,
          clienteCodigo: ag.cliente.codigo,
          servicos: ag.servicos.map((s) => s.nome),
          valor: item.valor,
          comissao: item.comissao,
        }];
      });
      res.json({ atendimentos, truncado: agendamentos.length > LIMITE_DETALHE, limite: LIMITE_DETALHE });
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar os atendimentos do profissional');
    }
  });

  // Histórico de alterações sensíveis (só administrador): últimas 200, com o nome de quem alterou
  router.get('/auditoria', verificarSupervisorToken, async (req, res) => {
    try {
      if (!usuarioEhAdmin(req)) return res.status(403).json({ erro: 'Apenas o administrador vê o histórico de alterações.' });
      const registros = await prisma.registroAuditoria.findMany({ orderBy: { criadoEm: 'desc' }, take: 200 });
      const ids = [...new Set(registros.map((r) => r.usuarioId).filter((id): id is string => Boolean(id)))];
      const nomes = new Map((await prisma.colaborador.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }))
        .map((c) => [c.id, c.nome]));
      res.json(registros.map((r) => ({ ...r, usuarioNome: r.usuarioId ? nomes.get(r.usuarioId) ?? 'Usuário removido' : 'Sistema' })));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar o histórico de alterações');
    }
  });

  return router;
}
