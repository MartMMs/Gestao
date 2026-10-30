import { Router } from 'express';
import { prisma } from '../db';
import { verificarSupervisorToken } from '../auth';
import { HttpError, responderErro } from '../lib/http';
import { getEmpresaConfig } from '../services/configService';
import { dataValida, instanteNoFuso, partesNoFuso } from '../../shared/agenda';

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
  cancelados: number;
};

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

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

export function createRelatoriosRouter() {
  const router = Router();

  /**
   * Relatório financeiro (supervisão e administração): faturamento e comissão por profissional e por serviço.
   * Usa os valores gravados em cada atendimento, então mudar preço ou comissão de um serviço não altera o passado.
   */
  router.get('/relatorios/financeiro', verificarSupervisorToken, async (req, res) => {
    try {
      const { inicio, fim } = lerPeriodo(req.query.de, req.query.ate);
      const empresa = await getEmpresaConfig();
      const usarComissao = empresa.usarComissao !== false;
      // O dia seguinte ao fim, à meia-noite no fuso do negócio, fecha o intervalo
      const depoisDoFim = new Date(Date.parse(`${fim}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const agendamentos = await prisma.agendamento.findMany({
        where: {
          data: { gte: instanteNoFuso(inicio, '00:00'), lt: instanteNoFuso(depoisDoFim, '00:00') },
          status: { in: ['completed', 'no_show', 'cancelled'] },
        },
        select: {
          status: true, valorTotal: true, valorComissao: true, colaboradorId: true,
          colaborador: { select: { nome: true, ativo: true } },
          servicos: { select: { id: true, nome: true, preco: true } },
        },
      });

      const porProfissional = new Map<string, LinhaProfissional>();
      const porServico = new Map<string, { nome: string; quantidade: number; faturamento: number }>();
      for (const ag of agendamentos) {
        const linha = porProfissional.get(ag.colaboradorId) ?? {
          colaboradorId: ag.colaboradorId, nome: ag.colaborador.nome, ativo: ag.colaborador.ativo,
          concluidos: 0, faturamento: 0, comissao: 0, ticketMedio: 0, faltas: 0, cancelados: 0,
        };
        if (ag.status === 'no_show') linha.faltas += 1;
        else if (ag.status === 'cancelled') linha.cancelados += 1;
        else {
          const valor = ag.valorTotal ?? ag.servicos.reduce((soma, s) => soma + s.preco, 0);
          linha.concluidos += 1;
          linha.faturamento += valor;
          linha.comissao += usarComissao ? ag.valorComissao ?? 0 : 0;
          // Valor de cada serviço proporcional ao total gravado (o preço pode ter mudado depois)
          const somaPrecos = ag.servicos.reduce((soma, s) => soma + s.preco, 0);
          for (const s of ag.servicos) {
            const item = porServico.get(s.id) ?? { nome: s.nome, quantidade: 0, faturamento: 0 };
            item.quantidade += 1;
            item.faturamento += somaPrecos > 0 ? valor * (s.preco / somaPrecos) : valor / ag.servicos.length;
            porServico.set(s.id, item);
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
      const soma = (campo: 'concluidos' | 'faturamento' | 'comissao' | 'faltas' | 'cancelados') =>
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
          cancelados: soma('cancelados'),
        },
        profissionais,
        servicos,
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao gerar o relatório financeiro');
    }
  });

  return router;
}
