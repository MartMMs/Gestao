import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// O totem e a ficha interna seguem a mesma regra (shared/segmento.ts): as perguntas de saúde só em clínica e spa,
// as de massagem só em spa
let segmentoAtual: string | undefined;
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../api', () => ({ useCompanyConfig: () => ({ data: { segmento: segmentoAtual } }) }));

const { StepIdentification } = await import('./components/StepIdentification');
const { AnamneseForm, initialAnamnese } = await import('../../components/AnamneseForm');

const totem = (segmento?: string) => renderToStaticMarkup(
  <StepIdentification reservation={{} as never} segmento={segmento} nomeEmpresa="Empresa X" onSubmit={() => {}} onBack={() => {}} />);
const ficha = (segmento?: string) => {
  segmentoAtual = segmento;
  return renderToStaticMarkup(<AnamneseForm data={initialAnamnese} onChange={() => {}} onClose={() => {}} />);
};

describe('totem: perguntas por segmento', () => {
  it('clínica mostra saúde, não as preferências de spa', () => {
    const h = totem('clinica_saude');
    expect(h).toContain('Está gestante?');
    expect(h).toContain('Cirurgia Recente');
    expect(h).not.toContain('Experiência Aromática');
    expect(h).toContain('informações de saúde acima');
  });
  it('spa mostra saúde e preferências', () => {
    const h = totem('spa_bemestar');
    expect(h).toContain('Está gestante?');
    expect(h).toContain('Experiência Aromática');
  });
  it('geral não mostra saúde nem spa; o consentimento cita as alergias (dado de saúde)', () => {
    for (const s of ['geral', 'beleza_barbearia']) {
      const h = totem(s);
      expect(h).not.toContain('Está gestante?');
      expect(h).not.toContain('Experiência Aromática');
      expect(h).toContain('Tem alguma alergia?');
      expect(h).toContain('Autorizo Empresa X a usar meus dados pessoais e as informações acima (inclusive sobre alergias)');
    }
  });
});

describe('sem segmento (a configuração não carregou)', () => {
  it('totem e ficha mostram tudo, em vez de esconder as perguntas de saúde de uma clínica', () => {
    const t = totem(undefined);
    expect(t).toContain('Está gestante?');
    expect(t).toContain('informações de saúde acima');
    const f = ficha(undefined);
    expect(f).toContain('Marcapasso');
    expect(f).toContain('Preferências do Tratamento');
  });
});

describe('ficha interna por segmento', () => {
  it('clínica: perguntas de saúde, sem preferências de spa', () => {
    const h = ficha('clinica_saude');
    expect(h).toContain('Marcapasso');
    expect(h).toContain('Está grávida?');
    expect(h).not.toContain('Preferências do Tratamento');
  });
  it('spa: tudo', () => {
    const h = ficha('spa_bemestar');
    expect(h).toContain('Marcapasso');
    expect(h).toContain('Preferências do Tratamento');
  });
  it('geral: só as gerais (como no totem)', () => {
    const h = ficha('geral');
    expect(h).not.toContain('Marcapasso');
    expect(h).not.toContain('Está grávida?');
    expect(h).not.toContain('Preferências do Tratamento');
    expect(h).toContain('Tem alguma alergia?');
  });
});
