import { describe, expect, it } from 'vitest';
import { csvHorasPrevistas } from './horasPrevistasCsv';

describe('csvHorasPrevistas', () => {
  const csv = csvHorasPrevistas([
    { nome: 'Ana "Aninha" Souza', cargo: 'Massagista; Sênior', dias: 22, semTurno: 0, normais: 176, extras: 2.5, total: 178.5 },
    { nome: '=HYPERLINK("x")', cargo: undefined, dias: 20, semTurno: 1, normais: 160, extras: 0, total: 160 },
  ], 'Novembro de 2026');
  const linhas = csv.slice(1).trimEnd().split('\r\n');

  it('começa com BOM e usa ";"', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(linhas[0]).toBe('Colaborador;Cargo;Mês;Dias trabalhados;Dias sem turno;Horas normais;Horas extras;Total');
  });

  it('escapa aspas, ";" e fórmulas', () => {
    expect(linhas[1]).toBe('"Ana ""Aninha"" Souza";"Massagista; Sênior";Novembro de 2026;22;0;176;2,5;178,5');
    expect(linhas[2].startsWith(`"'=HYPERLINK(""x"")";`)).toBe(true);
  });

  it('fecha com a linha de totais', () => {
    expect(linhas[3]).toBe('Total;;Novembro de 2026;42;1;336;2,5;338,5');
  });
});
