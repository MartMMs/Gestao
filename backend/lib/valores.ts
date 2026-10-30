// Valores gravados no atendimento no momento em que os serviços são definidos: mudar preço ou comissão do
// serviço depois não reescreve faturamento nem comissão já calculados
type ServicoComValor = { preco: number; comissaoPercentual?: number | null };

export const valorDosServicos = (servicos: ServicoComValor[]) =>
  Math.round(servicos.reduce((soma, s) => soma + s.preco, 0) * 100) / 100;

export const comissaoDosServicos = (servicos: ServicoComValor[]) =>
  Math.round(servicos.reduce((soma, s) => soma + s.preco * ((s.comissaoPercentual ?? 0) / 100), 0) * 100) / 100;
