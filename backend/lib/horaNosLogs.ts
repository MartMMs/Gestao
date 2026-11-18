// Toda linha do terminal da API começa com data e hora de Brasília (ex.: "[18/11 18:42:07]"), para saber quando algo
// aconteceu (lembretes, respostas do WhatsApp, erros). Importado primeiro no server.ts
const hora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '');

for (const metodo of ['log', 'info', 'warn', 'error'] as const) {
  const original = console[metodo].bind(console);
  console[metodo] = (...args: unknown[]) => original(`[${hora()}]`, ...args);
}
