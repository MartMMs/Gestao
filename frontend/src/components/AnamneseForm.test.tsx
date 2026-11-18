import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../api', () => ({ useCompanyConfig: () => ({ data: { segmento: 'spa_bemestar' } }) }));
const { AnamneseForm, initialAnamnese } = await import('./AnamneseForm');

const render = (props: Partial<Parameters<typeof AnamneseForm>[0]>) =>
  renderToStaticMarkup(<AnamneseForm data={initialAnamnese} onChange={() => {}} onClose={() => {}} {...props} />);

describe('AnamneseForm: ficha que não cabe nos campos', () => {
  it('mostra a declaração do totem em vez de parecer vazia', () => {
    const html = render({ declaracoesTotem: ['[Anamnese Autoatendimento 2026-11-10]: Alergia a amendoim'] });
    expect(html).toContain('Declaração do cliente no totem');
    expect(html).toContain('2026-11-10: Alergia a amendoim');
  });

  it('avisa quando a ficha existe mas é restrita a quem edita', () => {
    expect(render({ fichaRestrita: true })).toContain('já tem ficha registrada');
    expect(render({})).not.toContain('já tem ficha registrada');
  });
});
