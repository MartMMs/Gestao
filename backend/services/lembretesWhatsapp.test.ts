import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
const { filtroMarcarAusencia } = await import('./lembretesWhatsapp');

describe('marcar ausência pela resposta "2"', () => {
  it('só agendamento ainda marcado, sem aviso anterior, de cliente ativo, com este telefone e sem opt-out', () => {
    expect(filtroMarcarAusencia('ag1', '11987654321')).toEqual({
      id: 'ag1',
      status: 'scheduled',
      clienteAvisouAusenciaEm: null,
      cliente: { removidoEm: null, naoReceberWhatsapp: false, telefone: { in: ['11987654321', '(11) 98765-4321', '5511987654321'] } },
    });
  });
});
