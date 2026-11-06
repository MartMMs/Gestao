import { describe, expect, it } from 'vitest';
import { lerCsv, matrizParaClientes, tipoDaPlanilha } from './planilhaClientes';

describe('tipoDaPlanilha', () => {
  const arquivo = (name: string, type: string, size = 10) => ({ name, type, size });
  it('aceita csv e xlsx com tipo coerente', () => {
    expect(tipoDaPlanilha(arquivo('a.CSV', 'text/csv'))).toBe('csv');
    expect(tipoDaPlanilha(arquivo('a.csv', ''))).toBe('csv');
    expect(tipoDaPlanilha(arquivo('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe('xlsx');
  });
  it('recusa extensão errada, tipo trocado, vazio e grande', () => {
    expect(() => tipoDaPlanilha(arquivo('a.exe', ''))).toThrow(/\.csv ou \.xlsx/);
    expect(() => tipoDaPlanilha(arquivo('a.csv.exe', 'text/csv'))).toThrow(/\.csv ou \.xlsx/);
    expect(() => tipoDaPlanilha(arquivo('a.xlsx', 'text/html'))).toThrow(/não confere/);
    expect(() => tipoDaPlanilha(arquivo('a.csv', 'application/x-msdownload'))).toThrow(/não confere/);
    expect(() => tipoDaPlanilha(arquivo('a.csv', 'text/csv', 0))).toThrow(/vazio/);
    expect(() => tipoDaPlanilha(arquivo('a.csv', 'text/csv', 3 * 1024 * 1024))).toThrow(/2 MB/);
  });
});

describe('lerCsv', () => {
  it('separador ; com aspas, aspas escapadas, quebra dentro de aspas e BOM', () => {
    expect(lerCsv('﻿Nome;CPF\r\n"Silva; Ana";1\n"Diz ""oi""\nlinha 2";2\n')).toEqual([
      ['Nome', 'CPF'], ['Silva; Ana', '1'], ['Diz "oi"\nlinha 2', '2'],
    ]);
  });
  it('linha "sep=" do Excel define o separador e sai', () => {
    expect(lerCsv('sep=,\r\nNome;Apelido,CPF\nAna;A,1')).toEqual([['Nome;Apelido', 'CPF'], ['Ana;A', '1']]);
    expect(lerCsv('SEP=;\nNome;CPF\nAna;1')).toEqual([['Nome', 'CPF'], ['Ana', '1']]);
  });
  it('separador , quando o cabeçalho usa vírgula', () => {
    expect(lerCsv('nome,email\nAna,a@b.com')).toEqual([['nome', 'email'], ['Ana', 'a@b.com']]);
  });
});

describe('matrizParaClientes', () => {
  it('mapeia cabeçalhos em português, ignora colunas extras, completa zero do CPF', () => {
    expect(matrizParaClientes([
      ['Nome Completo', 'Celular', 'CPF', 'E-mail', 'Cidade'],
      ['Ana', '11987654321', '1234567890', 'a@b.com', 'SP'],
      ['', '', '', '', ''],
      ['Bia', null, null, null, null],
      ['', '', '', '', ''],
    ])).toEqual([
      { nome: 'Ana', telefone: '11987654321', cpf: '01234567890', email: 'a@b.com' },
      { nome: '', telefone: '', cpf: '', email: '' }, // linha em branco no meio continua (erro com número certo)
      { nome: 'Bia' },
    ]);
  });
  it('exige coluna Nome e ao menos um cliente', () => {
    expect(() => matrizParaClientes([['Telefone'], ['1']])).toThrow(/coluna "Nome"/);
    expect(() => matrizParaClientes([['Nome'], ['']])).toThrow(/não tem clientes/);
  });
  it('limita a 500 linhas', () => {
    expect(() => matrizParaClientes([['Nome'], ...Array.from({ length: 501 }, () => ['Ana'])])).toThrow(/Máximo de 500/);
  });
});
