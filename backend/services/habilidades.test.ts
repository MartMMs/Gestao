import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
vi.mock('./redisService', () => ({ redisService: {} }));
const { erroElegibilidade, habilidadeBarra } = await import('./agendaService');
const { chaveHabilidade, colaboradorComHabilidades, servicoParaResposta } = await import('./habilidadeService');

const servico = (habilidades: { id: string; ativa?: boolean }[]) => ({ id: 's1', nome: 'Drenagem', modoElegibilidade: 'habilidade', habilidadesExigidas: habilidades });
const habilitada = { id: 'c1', nome: 'Ana', habilidadesCadastradas: [{ id: 'h1' }] };
const semHabilidade = { id: 'c2', nome: 'Bia', habilidadesCadastradas: [] };

describe('exigência de habilidades nos 3 modos', () => {
  it('sempre: barra no totem e na agenda interna', () => {
    expect(habilidadeBarra('sempre', 'totem')).toBe(true);
    expect(habilidadeBarra('sempre', 'interno')).toBe(true);
  });
  it('apenas_totem: barra só no totem', () => {
    expect(habilidadeBarra('apenas_totem', 'totem')).toBe(true);
    expect(habilidadeBarra('apenas_totem', 'interno')).toBe(false);
  });
  it('desligado: não barra em lugar nenhum; valor desconhecido cai no mais seguro (barra)', () => {
    expect(habilidadeBarra('desligado', 'totem')).toBe(false);
    expect(habilidadeBarra('desligado', 'interno')).toBe(false);
    expect(habilidadeBarra('xyz', 'interno')).toBe(true);
  });
});

describe('filtragem de profissionais por habilidade', () => {
  it('só quem tem uma das habilidades exigidas passa quando a checagem está ligada', () => {
    expect(erroElegibilidade(habilitada, [servico([{ id: 'h1' }, { id: 'h2' }])])).toBeNull();
    expect(erroElegibilidade(semHabilidade, [servico([{ id: 'h1' }])])).toMatch(/habilidade/);
  });
  it('com a checagem desligada, todos passam', () => {
    expect(erroElegibilidade(semHabilidade, [servico([{ id: 'h1' }])], { checarHabilidade: false })).toBeNull();
  });
  it('habilidade arquivada não conta: serviço só com arquivadas deixa de restringir; profissional com arquivada não se habilita', () => {
    expect(erroElegibilidade(semHabilidade, [servico([{ id: 'h1', ativa: false }])])).toBeNull();
    const comArquivada = { ...habilitada, habilidadesCadastradas: [{ id: 'h1', ativa: false }] };
    expect(erroElegibilidade(comArquivada, [servico([{ id: 'h1' }])])).toMatch(/habilidade/);
  });
});

describe('cadastro de habilidades', () => {
  it('nome sem diferenciar maiúsculas nem espaços sobrando', () => {
    expect(chaveHabilidade('  Drenagem   Linfática ')).toBe(chaveHabilidade('drenagem linfática'));
  });
  it('respostas levam só as habilidades ativas e nunca as colunas legadas', () => {
    const r = servicoParaResposta({ nome: 'x', habilidadesPermitidasLegado: ['velha'], habilidadesExigidas: [{ id: 'h1', nome: 'A', ativa: true }, { id: 'h2', nome: 'B', ativa: false }] });
    expect(r).toEqual({ nome: 'x', habilidadeIds: ['h1'], habilidadesPermitidas: ['A'] });
    const c = colaboradorComHabilidades({ nome: 'y', habilidadesLegado: ['velha'], habilidadesCadastradas: [{ id: 'h2', nome: 'B', ativa: false }] });
    expect(c).toEqual({ nome: 'y', habilidadeIds: [], habilidades: [] });
  });
});
