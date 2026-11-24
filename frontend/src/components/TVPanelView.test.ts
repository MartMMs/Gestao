import { describe, expect, it } from 'vitest';
import { avisoDaTv } from './TVPanelView';

describe('aviso do painel da TV', () => {
  it('com sessão e API no ar mostra a agenda', () => {
    expect(avisoDaTv({ semSessao: false, semConexao: false, atualizadoEm: 1 })).toBeNull();
  });

  it('API fora: pede a recepção e mostra a hora da última atualização (Brasília)', () => {
    const aviso = avisoDaTv({ semConexao: true, atualizadoEm: Date.parse('2026-11-21T17:05:00Z') });
    expect(aviso).toEqual({ titulo: 'Sem conexão: chame a recepção', detalhe: 'Última atualização às 14:05' });
  });

  it('sem sessão e sem leitura nenhuma', () => {
    expect(avisoDaTv({ semSessao: true, atualizadoEm: 0 })).toEqual({ titulo: 'Painel desconectado: chame a recepção', detalhe: 'Ainda sem atualização da agenda' });
  });
});
