import { describe, expect, it } from 'vitest';
import { planejarMesGerado, type DiaGravado } from './gerarMesService';
import { aplicarAjusteEscala, gerarEscalaComRegras, separarTurno } from '../../shared/escala';

// Banco em memória: chave = data
type Banco = Map<string, DiaGravado>;
const gerar = (banco: Banco, mes: string, turno: string) => {
  const existentes = [...banco].map(([data, d]) => ({ data, tipo: d.tipo, descricao: d.descricao }));
  for (const { data, dia } of planejarMesGerado({ tipoEscala: '6x1', folgasDomingoNoMes: 2, mes, turno, hoje: '2026-10-01', existentes })) {
    banco.set(data, dia);
  }
};
// Leitura como na tela: contrato sem turno padrão + ajustes gravados
const mesLido = (banco: Banco, mes: string) =>
  gerarEscalaComRegras({ tipo: '6x1', dataInicio: '2026-10-01' }, 120, { folgasDomingoNoMes: 2 })
    .filter((d) => d.data.startsWith(mes))
    .map((d) => aplicarAjusteEscala(d, banco.get(d.data)));
const horas = (dias: ReturnType<typeof mesLido>) => dias.reduce((t, d) => {
  if (d.tipo !== 'trabalho' || !d.turno) return t;
  const { horaInicio, horaFim } = separarTurno(d.turno);
  const [a, b] = [horaInicio!, horaFim!].map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
  return t + (b - a) / 60;
}, 0);

describe('gerador mensal grava o turno por dia (snapshot)', () => {
  it('gerar dezembro com outro turno não muda novembro', () => {
    const banco: Banco = new Map();
    gerar(banco, '2026-11', '08:00-16:00');
    const novembroAntes = mesLido(banco, '2026-11');
    const horasAntes = horas(novembroAntes);
    gerar(banco, '2026-12', '10:00-19:00');
    const novembroDepois = mesLido(banco, '2026-11');
    expect(novembroDepois).toEqual(novembroAntes);
    expect(horas(novembroDepois)).toBe(horasAntes);
    expect(novembroDepois.filter((d) => d.tipo === 'trabalho').every((d) => d.turno === '08:00-16:00')).toBe(true);
    expect(mesLido(banco, '2026-12').filter((d) => d.tipo === 'trabalho').every((d) => d.turno === '10:00-19:00')).toBe(true);
  });

  it('preserva férias e afastamentos já registrados no mês', () => {
    const banco: Banco = new Map([
      ['2026-12-07', { tipo: 'folga', turno: null, descricao: 'Férias' }],
      ['2026-12-08', { tipo: 'folga', turno: null, descricao: 'Atestado médico' }],
    ]);
    gerar(banco, '2026-12', '09:00-18:00');
    expect(banco.get('2026-12-07')).toEqual({ tipo: 'folga', turno: null, descricao: 'Férias' });
    expect(banco.get('2026-12-08')).toEqual({ tipo: 'folga', turno: null, descricao: 'Atestado médico' });
    expect(banco.size).toBe(31);
  });
});
