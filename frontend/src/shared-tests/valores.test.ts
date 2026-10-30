import { describe, expect, it } from 'vitest';
import { comissaoDosServicos, comissaoProporcional, recalcularValores, valorDosServicos } from '@shared/valores';

const corte = { id: 'corte', preco: 100, comissaoPercentual: 10 };
const escova = { id: 'escova', preco: 50, comissaoPercentual: 20 };
const hidratacao = { id: 'hidratacao', preco: 80, comissaoPercentual: null };

describe('valores do atendimento', () => {
  it('soma preço e comissão com arredondamento em centavos', () => {
    expect(valorDosServicos([corte, escova])).toBe(150);
    expect(comissaoDosServicos([corte, escova])).toBe(20);
    expect(comissaoDosServicos([{ id: 'x', preco: 33.33, comissaoPercentual: 33.3 }])).toBe(11.1);
    expect(comissaoDosServicos([hidratacao])).toBe(0); // percentual nulo conta como 0
  });

  it('comissão proporcional ao valor da época', () => {
    // Corte custava 80 quando foi marcado; hoje custa 100 com 10%: a comissão é 8, não 10
    expect(comissaoProporcional(80, [corte])).toBe(8);
    // Dois serviços com percentuais diferentes: a proporção é a da soma (20 / 150)
    expect(comissaoProporcional(120, [corte, escova])).toBe(16);
    // Sem preço não há proporção: vale o percentual puro (0)
    expect(comissaoProporcional(50, [{ id: 'gratis', preco: 0, comissaoPercentual: 10 }])).toBe(0);
  });

  it('mesmos serviços: mantém os valores gravados', () => {
    expect(recalcularValores({ servicos: [corte], valorTotal: 80, valorComissao: 8 }, [corte])).toEqual({ valorTotal: 80, valorComissao: 8 });
  });

  it('serviço que ficou mantém a fatia da época; o novo entra com o preço de hoje', () => {
    // Época: corte + escova por 120 (comissão 16). Tira a escova, põe hidratação.
    const r = recalcularValores({ servicos: [corte, escova], valorTotal: 120, valorComissao: 16 }, [corte, hidratacao]);
    // Corte é 100/150 do preço de hoje: 120 * 2/3 = 80 e 16 * 2/3 = 10,67; hidratação soma 80 e 0
    expect(r).toEqual({ valorTotal: 160, valorComissao: 10.67 });
  });

  it('campo vazio é preenchido a partir do outro, sem reescrever o valor da época', () => {
    // Só a comissão vazia: proporcional ao valor gravado (80), não ao preço de hoje (100)
    expect(recalcularValores({ servicos: [corte], valorTotal: 80, valorComissao: null }, [corte])).toEqual({ valorTotal: 80, valorComissao: 8 });
    // Só o valor vazio: preço de hoje, comissão gravada mantida
    expect(recalcularValores({ servicos: [corte], valorTotal: null, valorComissao: 7 }, [corte])).toEqual({ valorTotal: 100, valorComissao: 7 });
    // Os dois vazios: preço e comissão de hoje
    expect(recalcularValores({ servicos: [corte], valorTotal: null, valorComissao: null }, [corte])).toEqual({ valorTotal: 100, valorComissao: 10 });
  });

  it('serviços antigos sem preço: os novos entram inteiros', () => {
    const gratis = { id: 'gratis', preco: 0, comissaoPercentual: 0 };
    expect(recalcularValores({ servicos: [gratis], valorTotal: 0, valorComissao: 0 }, [escova])).toEqual({ valorTotal: 50, valorComissao: 10 });
  });
});
