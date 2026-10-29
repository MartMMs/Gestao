// Valor em reais no formato brasileiro (R$ 1.234,50)
export const formatarReais = (valor: number) =>
  (Number.isFinite(valor) ? valor : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
