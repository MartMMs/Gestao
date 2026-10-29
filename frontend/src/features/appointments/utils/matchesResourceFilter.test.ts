import { describe, it, expect } from 'vitest';
import { matchesResourceFilter } from './appointmentCore';
const ap = (services: any, observation?: string) => ({ services, observation } as any);
describe('matchesResourceFilter', () => {
  it('all sempre true', () => expect(matchesResourceFilter(ap([]), 'all' as any)).toBe(true));
  it('massagem com acento/maiúscula', () => expect(matchesResourceFilter(ap(['MASSAGEM Relaxante']), 'sala_massagem' as any)).toBe(true));
  it('ofurô acentuado', () => expect(matchesResourceFilter(ap(['Banho de Ofurô']), 'ofuro' as any)).toBe(true));
  it('estética via observação', () => expect(matchesResourceFilter(ap([], 'Sala de Estética'), 'estetica' as any)).toBe(true));
  it('limpeza de pele', () => expect(matchesResourceFilter(ap(['Limpeza de Pele']), 'estetica' as any)).toBe(true));
  it('não casa recurso errado', () => expect(matchesResourceFilter(ap(['Corte']), 'ofuro' as any)).toBe(false));
  it('services ausente não quebra', () => expect(() => matchesResourceFilter(ap(undefined), 'ofuro' as any)).not.toThrow());
});
