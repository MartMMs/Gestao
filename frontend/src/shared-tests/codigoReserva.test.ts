import { describe, it, expect } from 'vitest';
import { codigoReserva, lerCodigoReserva } from '@shared/codigoReserva';

describe('código da reserva', () => {
  it('usa os 6 últimos caracteres do id, em maiúsculas', () => {
    expect(codigoReserva('3f2a9c1e-0b4d-4e8a-9f1c-7d6e5a1b2c3d')).toBe('AG-1B2C3D');
  });
  it('aceita o código digitado de vários jeitos e recusa outro texto', () => {
    for (const t of ['AG-1B2C3D', 'ag-1b2c3d', ' ag 1b2c3d ', 'AG1B2C3D']) expect(lerCodigoReserva(t)).toBe('AG-1B2C3D');
    for (const t of ['Maria', '1b2c3d', 'AG-1B2C', 'AG-1B2C3D4']) expect(lerCodigoReserva(t)).toBeNull();
  });
});
