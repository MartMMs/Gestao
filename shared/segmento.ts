// Quais grupos de perguntas da ficha cada segmento usa. Regra única do totem e da ficha interna:
// as gerais (alergia, observações) valem para todos; as de saúde, para clínicas e spas; as de massagem, só para spas.
// Sem segmento (a configuração não carregou), mostra tudo: esconder as de saúde numa clínica é pior que sobrar pergunta.
export function perguntasDoSegmento(segmento: string | null | undefined) {
  if (!segmento) return { saude: true, spa: true };
  const spa = segmento === 'spa_bemestar';
  return { saude: spa || segmento === 'clinica_saude', spa };
}
