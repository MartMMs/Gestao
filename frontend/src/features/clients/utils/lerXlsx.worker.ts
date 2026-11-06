// Lê o .xlsx fora da tela: o descompactar da biblioteca é síncrono, e um arquivo "bomba" (pequeno compactado,
// gigante aberto) travaria a aba inteira. Aqui quem trava é o worker, que a tela encerra pelo prazo.
import { readSheet } from 'read-excel-file/browser';

const contexto = self as unknown as { onmessage: ((evento: MessageEvent<ArrayBuffer>) => void) | null; postMessage: (mensagem: unknown) => void };

contexto.onmessage = async (evento) => {
  try {
    // Números ficam como texto (CPF, telefone)
    contexto.postMessage({ ok: true, matriz: await readSheet(evento.data, { parseNumber: (n: string) => n }) });
  } catch {
    contexto.postMessage({ ok: false });
  }
};
