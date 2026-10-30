import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { isApiError, useRelatorioFinanceiro, type RelatorioFinanceiro } from '../../../api';
import { useAuth } from '../../../AuthContext';

const reais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Atalhos de período mais usados no fechamento
const periodoRapido = (tipo: 'mes' | 'mesPassado' | '30dias') => {
  const hoje = hojeIso();
  const [ano, mes] = hoje.split('-').map(Number);
  if (tipo === 'mes') return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  if (tipo === 'mesPassado') {
    const inicio = new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 10);
    const fim = new Date(Date.UTC(ano, mes - 1, 0)).toISOString().slice(0, 10);
    return { de: inicio, ate: fim };
  }
  const inicio = new Date(Date.parse(`${hoje}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return { de: inicio, ate: hoje };
};

// CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português
const baixarCsv = (relatorio: RelatorioFinanceiro) => {
  const numero = (v: number) => v.toFixed(2).replace('.', ',');
  const texto = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const cabecalho = ['Profissional', 'Atendimentos concluídos', 'Faturamento', ...(relatorio.usarComissao ? ['Comissão'] : []), 'Ticket médio', 'Faltas', 'Cancelados'];
  const linhas = relatorio.profissionais.map((p) => [
    texto(p.nome + (p.ativo ? '' : ' (desligado)')), String(p.concluidos), numero(p.faturamento),
    ...(relatorio.usarComissao ? [numero(p.comissao)] : []), numero(p.ticketMedio), String(p.faltas), String(p.cancelados),
  ]);
  const conteudo = [cabecalho.map(texto), ...linhas].map((l) => l.join(';')).join('\r\n');
  const blob = new Blob([`﻿${conteudo}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-financeiro-${relatorio.periodo.de}-a-${relatorio.periodo.ate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export function RelatorioFinanceiroTab() {
  const { token } = useAuth();
  const [periodo, setPeriodo] = useState(() => periodoRapido('mes'));
  const { data, isLoading, error } = useRelatorioFinanceiro(token, periodo.de, periodo.ate);
  const maiorFaturamento = useMemo(() => Math.max(1, ...(data?.profissionais.map((p) => p.faturamento) ?? [])), [data]);

  const cartoes = data ? [
    { rotulo: 'Faturamento', valor: reais(data.totais.faturamento), icone: 'payments' },
    ...(data.usarComissao ? [
      { rotulo: 'Comissões', valor: reais(data.totais.comissao), icone: 'percent' },
      { rotulo: 'Líquido (após comissões)', valor: reais(data.totais.liquido), icone: 'account_balance_wallet' },
    ] : []),
    { rotulo: 'Atendimentos concluídos', valor: String(data.totais.concluidos), icone: 'task_alt' },
    { rotulo: 'Faltas', valor: String(data.totais.faltas), icone: 'person_off' },
    { rotulo: 'Cancelados', valor: String(data.totais.cancelados), icone: 'event_busy' },
  ] : [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-headline text-on-surface">Relatório financeiro</h2>
          <p className="text-sm text-on-surface-variant">
            Faturamento{data?.usarComissao !== false ? ' e comissão' : ''} por profissional, com os valores gravados em cada atendimento concluído.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {([['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['30dias', 'Últimos 30 dias']] as const).map(([tipo, rotulo]) => (
            <button key={tipo} type="button" onClick={() => setPeriodo(periodoRapido(tipo))} className="px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-surface-container text-on-surface-variant hover:text-primary">
              {rotulo}
            </button>
          ))}
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            De
            <input type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, de: e.target.value }))} className="block mt-1 bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm normal-case" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Até
            <input type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, ate: e.target.value }))} className="block mt-1 bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm normal-case" />
          </label>
          <button type="button" disabled={!data} onClick={() => data && baixarCsv(data)} className="px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-primary text-on-primary disabled:opacity-50 flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">download</span> Exportar planilha
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {isApiError(error) ? error.message : 'Não foi possível carregar o relatório.'}
        </p>
      )}
      {isLoading && <p className="text-sm text-on-surface-variant">Carregando relatório...</p>}

      {data && (
        <>
          <p className="text-xs text-on-surface-variant">Período: {dataBr(data.periodo.de)} a {dataBr(data.periodo.ate)}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {cartoes.map((c) => (
              <div key={c.rotulo} className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-4">
                <span className="material-symbols-outlined text-primary text-[20px]">{c.icone}</span>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mt-1">{c.rotulo}</p>
                <p className="text-lg font-bold text-on-surface tabular-nums">{c.valor}</p>
              </div>
            ))}
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-3xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-low text-[10px] uppercase tracking-widest text-outline">
                <tr>
                  <th className="text-left py-3 px-4">Profissional</th>
                  <th className="text-right py-3 px-4">Concluídos</th>
                  <th className="text-left py-3 px-4">Faturamento</th>
                  {data.usarComissao && <th className="text-right py-3 px-4">Comissão</th>}
                  <th className="text-right py-3 px-4">Ticket médio</th>
                  <th className="text-right py-3 px-4">Faltas</th>
                  <th className="text-right py-3 px-4">Cancelados</th>
                </tr>
              </thead>
              <tbody>
                {data.profissionais.length === 0 && (
                  <tr><td colSpan={7} className="py-6 px-4 text-center text-on-surface-variant">Nenhum atendimento concluído, falta ou cancelamento no período.</td></tr>
                )}
                {data.profissionais.map((p) => (
                  <tr key={p.colaboradorId} className="border-t border-outline-variant/10">
                    <td className="py-3 px-4 font-medium text-on-surface">
                      {p.nome}{!p.ativo && <span className="ml-2 text-[10px] uppercase text-on-surface-variant">desligado</span>}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">{p.concluidos}</td>
                    <td className="py-3 px-4 min-w-48">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (p.faturamento / maiorFaturamento) * 100)}%`, maxWidth: '8rem' }} />
                        <span className="tabular-nums">{reais(p.faturamento)}</span>
                      </div>
                    </td>
                    {data.usarComissao && <td className="py-3 px-4 text-right tabular-nums">{reais(p.comissao)}</td>}
                    <td className="py-3 px-4 text-right tabular-nums">{reais(p.ticketMedio)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{p.faltas}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{p.cancelados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.servicos.length > 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-3xl p-5">
              <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-3">Serviços mais vendidos</h3>
              <ul className="space-y-2">
                {data.servicos.slice(0, 10).map((s) => (
                  <li key={s.nome} className="flex justify-between gap-3 text-sm">
                    <span className="text-on-surface truncate">{s.nome} <span className="text-on-surface-variant">· {s.quantidade}x</span></span>
                    <span className="tabular-nums text-on-surface">{reais(s.faturamento)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
