import React, { useState } from 'react';
import { useAcessosHistorico, useEmployees, type FiltroAcessosHistorico } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { periodoRapido } from '../../../utils/periodos';

const campo = 'bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl h-10 px-3 text-on-surface';

// Trilha LGPD: quem abriu o histórico de qual cliente (gravada em GET /agendamentos?clienteId=...)
export function AcessosHistoricoClientes() {
  const { token } = useAuth();
  const { data: equipe = [] } = useEmployees(token);
  const [rascunho, setRascunho] = useState<FiltroAcessosHistorico>(() => ({ ...periodoRapido('mes'), colaboradorId: '', cliente: '', pagina: 1 }));
  const [filtro, setFiltro] = useState(rascunho);
  const { data, isLoading, isFetching, error, refetch } = useAcessosHistorico(token, filtro);
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;
  const alterar = (parcial: Partial<FiltroAcessosHistorico>) => setRascunho((atual) => ({ ...atual, ...parcial }));
  const irPara = (pagina: number) => setFiltro((atual) => ({ ...atual, pagina }));

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-3xl p-5">
      <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-1">Acessos ao histórico de clientes</h3>
      <p className="text-xs text-on-surface-variant mb-3">Quem abriu o histórico de atendimentos de cada cliente, de qual IP e quando.</p>

      <form
        className="flex flex-wrap items-end gap-3 mb-3"
        onSubmit={(event) => { event.preventDefault(); setFiltro({ ...rascunho, pagina: 1 }); }}
      >
        <div className="flex items-end gap-3 shrink-0 whitespace-nowrap">
        <label className="text-xs text-on-surface-variant flex flex-col gap-1">De
          <input type="date" required max={rascunho.ate} value={rascunho.de} onChange={(e) => alterar({ de: e.target.value })} className={campo} />
        </label>
        <label className="text-xs text-on-surface-variant flex flex-col gap-1">Até
          <input type="date" required min={rascunho.de} value={rascunho.ate} onChange={(e) => alterar({ ate: e.target.value })} className={campo} />
        </label>
        </div>
        <label className="text-xs text-on-surface-variant flex flex-col gap-1">Quem acessou
          <select value={rascunho.colaboradorId} onChange={(e) => alterar({ colaboradorId: e.target.value })} className={campo}>
            <option value="">Todos</option>
            {equipe.map((pessoa) => <option key={pessoa.id} value={pessoa.id}>{pessoa.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-on-surface-variant flex flex-col gap-1">Cliente
          <input type="search" maxLength={100} placeholder="Nome do cliente" value={rascunho.cliente} onChange={(e) => alterar({ cliente: e.target.value })} className={campo} />
        </label>
        <button type="submit" className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:bg-primary-dim">Filtrar</button>
      </form>

      {isLoading && <p className="text-xs text-on-surface-variant">Carregando...</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error instanceof Error ? error.message : 'Não foi possível carregar os acessos.'}{' '}
          <button type="button" onClick={() => refetch()} className="font-bold underline">Tentar de novo</button>
        </p>
      )}
      {data && data.itens.length === 0 && <p className="text-xs text-on-surface-variant">{filtro.cliente || filtro.colaboradorId ? 'Nenhum acesso no período com esse cliente ou essa pessoa. Confira o nome digitado.' : 'Nenhum acesso no período.'}</p>}
      {data && data.itens.length > 0 && (
        <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-on-surface-variant">
                <th className="py-1 pr-3 font-bold">Data e hora</th>
                <th className="py-1 pr-3 font-bold">Quem acessou</th>
                <th className="py-1 pr-3 font-bold">Cliente</th>
                <th className="py-1 pr-3 font-bold">IP</th>
                <th className="py-1 font-bold text-right">Atendimentos vistos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {data.itens.map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(a.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                  <td className="py-1.5 pr-3">{a.colaboradorNome}</td>
                  <td className="py-1.5 pr-3">{a.clienteNome}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{a.ip ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.registros}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 mt-3 text-xs text-on-surface-variant">
            <span>{data.total} acesso(s) · página {data.pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button type="button" disabled={filtro.pagina <= 1} onClick={() => irPara(filtro.pagina - 1)} className="px-3 py-1 rounded-lg border border-outline-variant/30 disabled:opacity-40">Anterior</button>
              <button type="button" disabled={filtro.pagina >= totalPaginas} onClick={() => irPara(filtro.pagina + 1)} className="px-3 py-1 rounded-lg border border-outline-variant/30 disabled:opacity-40">Próxima</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
