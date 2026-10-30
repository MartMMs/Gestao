// Datas AAAA-MM-DD no fuso do negócio (o navegador pode estar em outro fuso)
export const hojeNoNegocio = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export type PeriodoRapido = 'mes' | 'mesPassado' | '30dias' | '12meses';

// Atalhos de período usados no dashboard e no relatório (mesma regra nos dois)
export const periodoRapido = (tipo: PeriodoRapido) => {
  const hoje = hojeNoNegocio();
  const [ano, mes] = hoje.split('-').map(Number);
  if (tipo === 'mes') return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  if (tipo === 'mesPassado') {
    return {
      de: new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 10),
      ate: new Date(Date.UTC(ano, mes - 1, 0)).toISOString().slice(0, 10),
    };
  }
  const dias = tipo === '30dias' ? 29 : 365;
  return { de: new Date(Date.parse(`${hoje}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10), ate: hoje };
};
