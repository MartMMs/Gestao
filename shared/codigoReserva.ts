// Código curto da reserva (vai no voucher do totem e aparece no agendamento): os 6 últimos caracteres do id
export const codigoReserva = (id: string) => `AG-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;

// Texto digitado na busca -> código no formato canônico ("ag 1a2b3c", "AG-1A2B3C"), ou null se não for um código
export const lerCodigoReserva = (texto: string) => {
  const m = /^\s*ag[\s-]?([0-9a-z]{6})\s*$/i.exec(texto);
  return m ? `AG-${m[1].toUpperCase()}` : null;
};
