// Valores gravados no atendimento no momento em que os serviços são definidos: mudar preço ou comissão do
// serviço depois não reescreve faturamento nem comissão já calculados
export type ServicoComValor = { id?: string; preco: number; comissaoPercentual?: number | null };

export const centavos = (valor: number) => Math.round(valor * 100) / 100;

export const valorDosServicos = (servicos: ServicoComValor[]) =>
  centavos(servicos.reduce((soma, s) => soma + s.preco, 0));

// Fórmula única da comissão (preço x percentual de hoje), sem arredondar: quem precisa arredonda no fim
const comissaoBruta = (servicos: ServicoComValor[]) =>
  servicos.reduce((soma, s) => soma + s.preco * ((s.comissaoPercentual ?? 0) / 100), 0);

export const comissaoDosServicos = (servicos: ServicoComValor[]) => centavos(comissaoBruta(servicos));

/**
 * Comissão de um atendimento cujo valor gravado é o da época: proporcional a esse valor, com o percentual
 * de hoje dos serviços (mesma regra da migration que preencheu os antigos). Sem preço, vale o percentual puro.
 */
export const comissaoProporcional = (valorTotal: number, servicos: ServicoComValor[]) => {
  // Somas sem arredondar antes da divisão, como no SQL da migration. No meio centavo exato os dois podem diferir em
  // 1 centavo (o Postgres arredonda em decimal, o JS em ponto flutuante); só afeta os antigos corrigidos pela migration
  const preco = servicos.reduce((soma, s) => soma + s.preco, 0);
  const comissao = comissaoBruta(servicos);
  return preco > 0 ? centavos((valorTotal * comissao) / preco) : centavos(comissao);
};

export const mesmosServicos = (a: { id: string }[], b: { id: string }[]) =>
  a.length === b.length && a.every((s) => b.some((o) => o.id === s.id));

/**
 * Valor e comissão de um atendimento como entram no faturamento: os gravados; nos antigos sem valor gravado,
 * o preço de hoje e a comissão proporcional a ele. Relatório, detalhe, totem e dashboard usam só esta regra.
 */
export const valoresGravados = (ag: { valorTotal: number | null; valorComissao: number | null; servicos: ServicoComValor[] }) => {
  const valor = ag.valorTotal ?? valorDosServicos(ag.servicos);
  return { valor, comissao: ag.valorComissao ?? comissaoProporcional(valor, ag.servicos) };
};

type Gravado = { servicos: (ServicoComValor & { id: string })[]; valorTotal: number | null; valorComissao: number | null };

/**
 * Valor e comissão de um atendimento editado.
 * - Campo vazio (atendimento antigo) é preenchido a partir do outro, que guarda o valor da época.
 * - Serviços que ficaram mantêm a fatia da época: o valor na proporção do preço de cada um e a comissão na
 *   proporção da comissão de cada um (tirar um serviço de 20% não pode inflar nem encolher a comissão dos de 10%).
 * - Os adicionados entram com o preço e a comissão de hoje.
 */
export const recalcularValores = (antigo: Gravado, servicos: (ServicoComValor & { id: string })[]) => {
  const { valor: total, comissao } = valoresGravados(antigo);
  if (mesmosServicos(servicos, antigo.servicos)) return { valorTotal: total, valorComissao: comissao };

  const ficaram = antigo.servicos.filter((a) => servicos.some((s) => s.id === a.id));
  const novos = servicos.filter((s) => !antigo.servicos.some((a) => a.id === s.id));
  const fatia = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);
  // Sem preço hoje em nenhum dos antigos (mas com valor gravado): a fatia é pela quantidade de serviços
  const precoAntigo = valorDosServicos(antigo.servicos);
  const fracaoValor = precoAntigo > 0 ? fatia(valorDosServicos(ficaram), precoAntigo) : fatia(ficaram.length, antigo.servicos.length);
  // A fatia de comissão usa os percentuais e preços de hoje. Se eles não reproduzem a comissão gravada (um percentual
  // ou um preço mudou depois da marcação), essa fatia poderia dobrar ou zerar a comissão: aí vale a fatia do preço.
  // Comparação em centavos inteiros (diferença de até 1 centavo é arredondamento)
  const emCentavos = (v: number) => Math.round(v * 100);
  const percentuaisDaEpoca = Math.abs(emCentavos(comissaoProporcional(total, antigo.servicos)) - emCentavos(comissao)) <= 1;
  // Somas sem arredondar: com comissão de hoje abaixo de meio centavo, as arredondadas dariam 0/0 e a comissão sumiria
  const fracaoComissao = percentuaisDaEpoca ? fatia(comissaoBruta(ficaram), comissaoBruta(antigo.servicos)) : fracaoValor;
  // Comissão nunca passa do valor do serviço.
  const valorFicou = total * fracaoValor;
  const comissaoFicou = Math.min(comissao * fracaoComissao, valorFicou);
  const valorTotal = centavos(valorFicou + valorDosServicos(novos));
  return {
    valorTotal,
    valorComissao: Math.min(centavos(comissaoFicou + comissaoDosServicos(novos)), valorTotal),
  };
};
