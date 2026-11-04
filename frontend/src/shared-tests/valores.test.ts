import { describe, expect, it } from 'vitest';
import { comissaoDosServicos, comissaoProporcional, recalcularValores, valorDosServicos, valoresGravados } from '@shared/valores';

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
    // Valor: corte é 100/150 do preço (120 * 2/3 = 80) + hidratação 80.
    // Comissão: corte é 10/20 da comissão de hoje (16 * 1/2 = 8) + hidratação 0.
    expect(r).toEqual({ valorTotal: 160, valorComissao: 8 });
  });

  it('tirar um serviço de percentual diferente não infla nem encolhe a comissão do que ficou', () => {
    // Gravado igual ao de hoje: corte (100, 10%) + escova (50, 20%) = 150 e comissão 20
    expect(recalcularValores({ servicos: [corte, escova], valorTotal: 150, valorComissao: 20 }, [corte])).toEqual({ valorTotal: 100, valorComissao: 10 });
    // Tirar um serviço sem comissão mantém a comissão inteira do que ficou
    expect(recalcularValores({ servicos: [corte, hidratacao], valorTotal: 180, valorComissao: 10 }, [corte])).toEqual({ valorTotal: 100, valorComissao: 10 });
    // Trocar A+B por A+C sem mudança de preço: comissão de A + comissão de C
    const c = { id: 'c', preco: 50, comissaoPercentual: 0 };
    expect(recalcularValores({ servicos: [corte, escova], valorTotal: 150, valorComissao: 20 }, [corte, c])).toEqual({ valorTotal: 150, valorComissao: 10 });
  });

  it('percentual mudado depois da marcação não deixa a comissão passar do valor', () => {
    const a = { id: 'a', preco: 100, comissaoPercentual: 60 };
    const b = { id: 'b', preco: 100, comissaoPercentual: 0 }; // era 60% na marcação (gravado 200 / 120)
    const r = recalcularValores({ servicos: [a, b], valorTotal: 200, valorComissao: 120 }, [a]);
    // Os percentuais de hoje não reproduzem os 120 gravados: vale a fatia do preço (metade)
    expect(r).toEqual({ valorTotal: 100, valorComissao: 60 });
  });

  it('percentual zerado depois da marcação não dobra nem zera a comissão do que ficou', () => {
    // Na marcação: 100 (10%) + 100 (10%) = 200 / 20. Depois o percentual do primeiro foi zerado.
    const a = { id: 'a', preco: 100, comissaoPercentual: 0 };
    const b = { id: 'b', preco: 100, comissaoPercentual: 10 };
    const gravado = { servicos: [a, b], valorTotal: 200, valorComissao: 20 };
    expect(recalcularValores(gravado, [b])).toEqual({ valorTotal: 100, valorComissao: 10 });
    expect(recalcularValores(gravado, [a])).toEqual({ valorTotal: 100, valorComissao: 10 });
    // Todos zerados hoje: a comissão gravada não some ao tirar um serviço
    const z = { id: 'z', preco: 100, comissaoPercentual: 0 };
    expect(recalcularValores({ servicos: [a, z], valorTotal: 200, valorComissao: 30 }, [a])).toEqual({ valorTotal: 100, valorComissao: 15 });
  });

  it('serviços que hoje estão sem preço, com valor gravado: a fatia é pela quantidade', () => {
    const x = { id: 'x', preco: 0, comissaoPercentual: 10 };
    const y = { id: 'y', preco: 0, comissaoPercentual: 10 };
    expect(recalcularValores({ servicos: [x, y], valorTotal: 100, valorComissao: 10 }, [x])).toEqual({ valorTotal: 50, valorComissao: 5 });
  });

  it('preço mudado depois da marcação (percentuais iguais) também usa a fatia do preço', () => {
    // Na marcação: corte 100 (10%) + escova 50 (20%) = 150 / 20. Depois o corte passou a custar 200.
    const corteNovo = { ...corte, preco: 200 };
    expect(recalcularValores({ servicos: [corteNovo, escova], valorTotal: 150, valorComissao: 20 }, [corteNovo]))
      .toEqual({ valorTotal: 120, valorComissao: 16 });
  });

  it('valoresGravados: gravado vale; vazio cai no preço de hoje com comissão proporcional', () => {
    expect(valoresGravados({ servicos: [corte], valorTotal: 80, valorComissao: 7 })).toEqual({ valor: 80, comissao: 7 });
    expect(valoresGravados({ servicos: [corte], valorTotal: 80, valorComissao: null })).toEqual({ valor: 80, comissao: 8 });
    expect(valoresGravados({ servicos: [corte, escova], valorTotal: null, valorComissao: null })).toEqual({ valor: 150, comissao: 20 });
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
