import { describe, expect, it, vi } from 'vitest';
import { tratarRespostaLembrete } from './confirmacaoWhatsapp';

const montar = (pendente: string | null, marcou = true) => ({
  telefone: '11987654321',
  agendamentoPendente: vi.fn(async () => pendente),
  esquecer: vi.fn(async () => {}),
  marcarAusencia: vi.fn(async () => marcou),
  responder: vi.fn(async () => {}),
});

describe('resposta ao lembrete', () => {
  it('Sim: não mexe na agenda, responde e esquece o número', async () => {
    const deps = montar('ag1');
    expect(await tratarRespostaLembrete({ ...deps, texto: '1' })).toBe('sim');
    expect(deps.marcarAusencia).not.toHaveBeenCalled();
    expect(deps.esquecer).toHaveBeenCalledWith('11987654321');
    expect(deps.responder).toHaveBeenCalledWith(expect.stringContaining('confirmado'));
  });

  it('Não: marca a ausência do agendamento e responde', async () => {
    const deps = montar('ag1');
    expect(await tratarRespostaLembrete({ ...deps, texto: 'Não poderei ir' })).toBe('nao');
    expect(deps.marcarAusencia).toHaveBeenCalledWith('ag1');
    expect(deps.responder).toHaveBeenCalledWith(expect.stringContaining('avisamos a equipe'));
  });

  it('ignora conversa comum, número sem lembrete pendente e agendamento que já não está marcado', async () => {
    const conversa = montar('ag1');
    expect(await tratarRespostaLembrete({ ...conversa, texto: 'Qual o endereço?' })).toBeNull();
    expect(conversa.agendamentoPendente).not.toHaveBeenCalled();
    const semLembrete = montar(null);
    expect(await tratarRespostaLembrete({ ...semLembrete, texto: '2' })).toBeNull();
    expect(semLembrete.responder).not.toHaveBeenCalled();
    const cancelado = montar('ag1', false);
    expect(await tratarRespostaLembrete({ ...cancelado, texto: '2' })).toBeNull();
    expect(cancelado.responder).not.toHaveBeenCalled();
  });
});
