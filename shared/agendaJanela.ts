// Período que a agenda carrega (GET /agendamentos sem ?clienteId=). Backend e frontend usam o mesmo valor;
// o servidor soma um dia de folga por causa do fuso.
export const JANELA_AGENDA_DIAS = 365;

// Teto do histórico de um cliente (GET /agendamentos?clienteId=): os mais recentes primeiro
export const LIMITE_HISTORICO_CLIENTE = 300;
