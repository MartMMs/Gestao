// Valores gravados no atendimento no momento em que os serviços são definidos: mudar preço ou comissão do
// serviço depois não reescreve faturamento nem comissão já calculados
export type ServicoComValor = { id?: string; preco: number; comissaoPercentual?: number | null };

const centavos = (valor: number) => Math.round(valor * 100) / 100;

export const valorDosServicos = (servicos: ServicoComValor[]) =>
  centavos(servicos.reduce((soma, s) => soma + s.preco, 0));

export const comissaoDosServicos = (servicos: ServicoComValor[]) =>
  centavos(servicos.reduce((soma, s) => soma + s.preco * ((s.comissaoPercentual ?? 0) / 100), 0));

/**
 * Comissão de um atendimento cujo valor gravado é o da época: proporcional a esse valor, com o percentual
 * de hoje dos serviços (mesma regra da migration que preencheu os antigos). Sem preço, vale o percentual puro.
 */
export const comissaoProporcional = (valorTotal: number, servicos: ServicoComValor[]) => {
  const preco = valorDosServicos(servicos);
  return preco > 0 ? centavos((valorTotal * comissaoDosServicos(servicos)) / preco) : comissaoDosServicos(servicos);
};

type Gravado = { servicos: (ServicoComValor & { id: string })[]; valorTotal: number | null; valorComissao: number | null };

/**
 * Valor e comissão de um atendimento editado.
 * - Campo vazio (atendimento antigo) é preenchido a partir do outro, que guarda o valor da época.
 * - Serviços que ficaram mantêm a fatia proporcional ao preço da época; só os adicionados entram com o
 *   preço e a comissão de hoje.
 */
export const recalcularValores = (antigo: Gravado, servicos: (ServicoComValor & { id: string })[]) => {
  const total = antigo.valorTotal ?? valorDosServicos(antigo.servicos);
  const comissao = antigo.valorComissao ?? comissaoProporcional(total, antigo.servicos);
  const mesmosServicos = servicos.length === antigo.servicos.length && servicos.every((s) => antigo.servicos.some((a) => a.id === s.id));
  if (mesmosServicos) return { valorTotal: total, valorComissao: comissao };

  const ficaram = antigo.servicos.filter((a) => servicos.some((s) => s.id === a.id));
  const novos = servicos.filter((s) => !antigo.servicos.some((a) => a.id === s.id));
  const precoAntigo = valorDosServicos(antigo.servicos);
  const fracao = precoAntigo > 0 ? valorDosServicos(ficaram) / precoAntigo : 0;
  return {
    valorTotal: centavos(total * fracao + valorDosServicos(novos)),
    valorComissao: centavos(comissao * fracao + comissaoDosServicos(novos)),
  };
};
