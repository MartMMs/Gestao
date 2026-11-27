import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// O totem e a ficha interna seguem a mesma regra (shared/segmento.ts): as perguntas de saúde só em clínica e spa,
// as de massagem só em spa
let segmentoAtual: string | undefined;
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../api', () => ({ useCompanyConfig: () => ({ data: { segmento: segmentoAtual } }) }));

const { StepIdentification } = await import('./components/StepIdentification');
const { AnamneseForm, initialAnamnese } = await import('../../components/AnamneseForm');
const { CamposDinamicos } = await import('../../components/CamposDinamicos');
const { presetDoSegmento, paraPublico } = await import('@shared/formularioAnamnese');

const totem = (segmento?: string) => renderToStaticMarkup(
  <StepIdentification reservation={{} as never} segmento={segmento} nomeEmpresa="Empresa X" onSubmit={() => {}} onBack={() => {}} />);
const ficha = (segmento?: string) => {
  segmentoAtual = segmento;
  return renderToStaticMarkup(<AnamneseForm data={initialAnamnese} onChange={() => {}} onClose={() => {}} />);
};

// O totem agora mostra o formulário configurável. Na primeira vez ele nasce do modelo do segmento
// (shared/formularioAnamnese.ts), que repete as perguntas que o totem sempre fez
const rotulosDoModelo = (segmento: string) => presetDoSegmento(segmento).map((c) => c.rotulo);
const totemComModelo = (segmento: string) => renderToStaticMarkup(
  <CamposDinamicos idBase="t" valores={{}} onChange={() => {}}
    campos={presetDoSegmento(segmento).map((c, i) => paraPublico({ ...c, id: String(i), ordem: i, ativa: true }))} />);

describe('totem: modelo inicial por segmento', () => {
  it('clínica traz saúde, não as preferências de spa', () => {
    expect(rotulosDoModelo('clinica_saude')).toContain('Está gestante?');
    expect(rotulosDoModelo('clinica_saude')).not.toContain('Experiência aromática');
  });
  it('spa traz saúde e preferências', () => {
    const h = totemComModelo('spa_bemestar');
    expect(h).toContain('Está gestante?');
    expect(h).toContain('Experiência aromática');
    expect(h).toContain('Pressão desejada na massagem');
  });
  it('geral e beleza não trazem saúde nem spa, mas perguntam da alergia', () => {
    for (const s of ['geral', 'beleza_barbearia']) {
      expect(rotulosDoModelo(s)).not.toContain('Está gestante?');
      expect(rotulosDoModelo(s).some((r) => /alergia/i.test(r))).toBe(true);
    }
  });
  it('o consentimento do totem cita as alergias quando não há dado de saúde', () => {
    const h = totem('geral');
    expect(h).toContain('Autorizo Empresa X a usar meus dados pessoais e as informações acima (inclusive sobre alergias)');
  });
});

describe('sem segmento (a configuração não carregou)', () => {
  it('totem e ficha mostram tudo, em vez de esconder as perguntas de saúde de uma clínica', () => {
    expect(totem(undefined)).toContain('informações de saúde acima');
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
