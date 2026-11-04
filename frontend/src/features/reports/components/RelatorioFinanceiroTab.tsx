import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { isApiError, useAtendimentosDoRelatorio, useAuditoria, useRelatorioFinanceiro, type RelatorioFinanceiro } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { periodoRapido } from '../../../utils/periodos';

const reais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

// CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português
const baixarCsv = (relatorio: RelatorioFinanceiro) => {
  const numero = (v: number) => v.toFixed(2).replace('.', ',');
  // Campo começando com = + - @ vira fórmula no Excel: o apóstrofo força texto
  const texto = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const cabecalho = ['Profissional', 'Atendimentos concluídos', 'Faturamento', ...(relatorio.usarComissao ? ['Comissão'] : []), 'Ticket médio', 'Faltas', 'Sem baixa', 'Cancelados'];
  const linhas = relatorio.profissionais.map((p) => [
    texto(p.nome + (p.ativo ? '' : ' (desligado)')), String(p.concluidos), numero(p.faturamento),
    ...(relatorio.usarComissao ? [numero(p.comissao)] : []), numero(p.ticketMedio), String(p.faltas), String(p.semBaixa), String(p.cancelados),
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

const STATUS_ROTULO: Record<string, string> = { completed: 'Concluído', no_show: 'Falta', cancelled: 'Cancelado', sem_baixa: 'Sem baixa' };

const ACAO_ROTULO: Record<string, string> = {
  'servico.alterado': 'Serviço alterado',
  'servico.tirado_de_linha': 'Serviço tirado de linha',
  'servico.reativado': 'Serviço voltou ao catálogo',
  'servico.excluido': 'Serviço excluído',
  'totem.cobranca': 'Cobrança do totem',
  'empresa.comissao': 'Comissão da empresa',
  'agendamento.reaberto': 'Atendimento reaberto',
  'agendamento.valores': 'Valor do atendimento alterado',
  'agendamento.excluido': 'Atendimento excluído',
  'servico.criado': 'Serviço criado',
};

const CAMPO_ROTULO: Record<string, string> = {
  preco: 'preço', comissaoPercentual: 'comissão (%)', nome: 'nome', duracao: 'duração (min)', ativo: 'ativo',
  exigirPagamento: 'cobrança online', percentualSinal: 'sinal (%)', usarComissao: 'usar comissão', existe: 'existe', status: 'situação', valorTotal: 'valor', valorComissao: 'comissão',
};

const valorLegivel = (campo: string, v: unknown) => {
  if (v === true) return 'sim';
  if (v === false) return 'não';
  if (v === null || v === undefined) return '—';
  if ((campo === 'preco' || campo === 'valorTotal' || campo === 'valorComissao') && typeof v === 'number') return reais(v);
  if (campo === 'status') return v === 'scheduled' ? 'Agendado' : STATUS_ROTULO[String(v)] ?? String(v);
  return String(v);
};

// Atendimentos de um profissional no período, para conferir o fechamento
function DetalheProfissional({ colaboradorId, de, ate, usarComissao }: { colaboradorId: string; de: string; ate: string; usarComissao: boolean }) {
  const { token } = useAuth();
  const { data, isLoading, error } = useAtendimentosDoRelatorio(token, colaboradorId, de, ate);
  if (isLoading) return <p className="text-xs text-on-surface-variant p-3">Carregando atendimentos...</p>;
  if (error) return <p className="text-xs text-error p-3">{isApiError(error) ? error.message : 'Não foi possível carregar os atendimentos.'}</p>;
  if (!data?.atendimentos.length) return <p className="text-xs text-on-surface-variant p-3">Nenhum atendimento no período.</p>;
  return (
    <>
    {data.truncado && (
      <p role="status" className="text-xs text-amber-700 dark:text-amber-300 px-3 pt-2">
        Mostrando os {data.limite} primeiros atendimentos do período: a soma desta lista fica menor que o total da linha. Escolha um período menor para conferir tudo.
      </p>
    )}
    <table className="w-full text-xs">
      <thead className="text-[10px] uppercase tracking-widest text-outline">
        <tr>
          <th className="text-left py-2 px-3">Data</th>
          <th className="text-left py-2 px-3">Cliente</th>
          <th className="text-left py-2 px-3">Serviços</th>
          <th className="text-left py-2 px-3">Situação</th>
          <th className="text-right py-2 px-3">Valor</th>
          {usarComissao && <th className="text-right py-2 px-3">Comissão</th>}
        </tr>
      </thead>
      <tbody>
        {data.atendimentos.map((a) => (
          <tr key={a.id} className="border-t border-outline-variant/10">
            <td className="py-2 px-3 tabular-nums">{dataBr(a.data)} {a.horario}</td>
            <td className="py-2 px-3">{a.cliente} <span className="font-mono text-on-surface-variant">#{a.clienteCodigo}</span></td>
            <td className="py-2 px-3">{a.servicos.join(', ')}</td>
            <td className="py-2 px-3">
              {STATUS_ROTULO[a.status] ?? a.status}
              {a.status === 'sem_baixa' && <span className="block text-[10px] text-on-surface-variant">Conclua ou marque falta na agenda</span>}
            </td>
            <td className="py-2 px-3 text-right tabular-nums">{reais(a.valor)}</td>
            {usarComissao && <td className="py-2 px-3 text-right tabular-nums">{reais(a.comissao)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// Histórico de alterações sensíveis (só o administrador vê)
function HistoricoAlteracoes() {
  const { token } = useAuth();
  const { data, isLoading, error, refetch } = useAuditoria(token, true);
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-3xl p-5">
      <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-1">Histórico de alterações</h3>
      <p className="text-xs text-on-surface-variant mb-3">Preços, comissões, serviços fora de linha e cobrança do totem: quem mudou e quando.</p>
      {isLoading && <p className="text-xs text-on-surface-variant">Carregando...</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          Não foi possível carregar o histórico.{' '}
          <button type="button" onClick={() => refetch()} className="font-bold underline">Tentar de novo</button>
        </p>
      )}
      {data && data.length === 0 && <p className="text-xs text-on-surface-variant">Nenhuma alteração registrada ainda.</p>}
      <ul className="divide-y divide-outline-variant/10">
        {data?.map((r) => (
          <li key={r.id} className="py-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-bold text-on-surface">{ACAO_ROTULO[r.acao] ?? r.acao} · {r.alvo}</span>
              <span className="text-on-surface-variant">{new Date(r.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {r.usuarioNome}</span>
            </div>
            <p className="text-on-surface-variant mt-0.5">
              {Object.keys(r.depois ?? {}).map((campo) => (
                `${CAMPO_ROTULO[campo] ?? campo}: ${valorLegivel(campo, r.antes?.[campo])} → ${valorLegivel(campo, r.depois?.[campo])}`
              )).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RelatorioFinanceiroTab() {
  const { token, currentUser } = useAuth();
  const [periodo, setPeriodo] = useState(() => periodoRapido('mes'));
  const [aberto, setAberto] = useState<string | null>(null);
  const alternar = (id: string) => setAberto((atual) => (atual === id ? null : id));
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
    { rotulo: 'Sem baixa', valor: String(data.totais.semBaixa), icone: 'pending_actions' },
    { rotulo: 'Cancelados', valor: String(data.totais.cancelados), icone: 'event_busy' },
  ] : [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-headline text-on-surface">Relatório financeiro</h2>
          <p className="text-sm text-on-surface-variant">
            {data ? `Faturamento${data.usarComissao ? ' e comissão' : ''} por profissional` : 'Faturamento por profissional'}, com os valores gravados em cada atendimento concluído. Clique num profissional para ver os atendimentos.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {([['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['30dias', 'Últimos 30 dias']] as const).map(([tipo, rotulo]) => {
            const atalho = periodoRapido(tipo);
            const ativo = atalho.de === periodo.de && atalho.ate === periodo.ate;
            return (
            <button key={tipo} type="button" aria-pressed={ativo} onClick={() => setPeriodo(atalho)} className={`px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wide ${ativo ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:text-primary'}`}>
              {rotulo}
            </button>
            );
          })}
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            De
            <input type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, de: e.target.value }))} className="block mt-1 bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm normal-case" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Até
            <input type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, ate: e.target.value }))} className="block mt-1 bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm normal-case" />
          </label>
          <button type="button" disabled={!data || data.profissionais.length === 0} onClick={() => data && baixarCsv(data)} title={data && data.profissionais.length === 0 ? 'Sem atendimentos no período' : undefined} className="px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-primary text-on-primary disabled:opacity-50 flex items-center gap-1">
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
          {data.totais.semBaixa > 0 && (
            <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-on-surface">
              {data.totais.semBaixa === 1 ? '1 atendimento' : `${data.totais.semBaixa} atendimentos`} sem baixa no período: o horário passou e
              ninguém concluiu nem marcou falta. Eles ficam fora do faturamento e da comissão até você concluir ou marcar falta na agenda.
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
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
                  <th className="text-right py-3 px-4" title="Horário passou sem concluir nem marcar falta">Sem baixa</th>
                  <th className="text-right py-3 px-4">Cancelados</th>
                </tr>
              </thead>
              <tbody>
                {data.profissionais.length === 0 && (
                  <tr><td colSpan={8} className="py-6 px-4 text-center text-on-surface-variant">Nenhum atendimento concluído, falta ou cancelamento no período.</td></tr>
                )}
                {data.profissionais.map((p) => (
                  <React.Fragment key={p.colaboradorId}>
                  {/* A linha inteira é atalho do mouse; o botão no nome é o controle (teclado e leitor de tela) */}
                  <tr
                    className="border-t border-outline-variant/10 cursor-pointer hover:bg-surface-container-low"
                    onClick={() => alternar(p.colaboradorId)}
                  >
                    <td className="py-3 px-4 font-medium text-on-surface">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); alternar(p.colaboradorId); }}
                        aria-expanded={aberto === p.colaboradorId}
                        aria-controls={`detalhe-${p.colaboradorId}`}
                        className="text-left rounded hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span className="material-symbols-outlined text-[16px] align-middle mr-1 text-on-surface-variant" aria-hidden="true">{aberto === p.colaboradorId ? 'expand_less' : 'expand_more'}</span>
                        {p.nome}
                      </button>
                      {!p.ativo && <span className="ml-2 text-[10px] uppercase text-on-surface-variant">desligado</span>}
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
                    <td className={`py-3 px-4 text-right tabular-nums ${p.semBaixa > 0 ? 'font-bold text-amber-700 dark:text-amber-300' : ''}`}>{p.semBaixa}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{p.cancelados}</td>
                  </tr>
                  {aberto === p.colaboradorId && (
                    <tr id={`detalhe-${p.colaboradorId}`} className="bg-surface-container-low/50">
                      <td colSpan={8} className="p-2">
                        <DetalheProfissional colaboradorId={p.colaboradorId} de={periodo.de} ate={periodo.ate} usarComissao={data.usarComissao} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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

      {currentUser?.role === 'admin' && <HistoricoAlteracoes />}
    </motion.div>
  );
}
