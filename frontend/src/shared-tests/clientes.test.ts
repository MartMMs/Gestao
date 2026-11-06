import { describe, expect, it } from 'vitest';
import { emailValido, limparTexto, lerCliente, validarImportacao } from '@shared/clientes';

describe('limparTexto', () => {
  it('tira invisíveis, controles e espaços repetidos', () => {
    expect(limparTexto('  Ana​  \t Maria‮ ')).toBe('Ana Maria');
    expect(limparTexto(null)).toBe('');
    expect(limparTexto({})).toBe('');
    expect(limparTexto(123)).toBe('123');
  });
});

describe('lerCliente', () => {
  it('aceita cliente completo e normaliza', () => {
    const { dados, erros } = lerCliente({ nome: " Ana D'Ávila-Souza ", telefone: '(11) 98765-4321', cpf: '529.982.247-25', email: ' Ana@Email.COM ' });
    expect(erros).toEqual([]);
    expect(dados).toEqual({ nome: "Ana D'Ávila-Souza", telefone: '11987654321', cpf: '52998224725', email: 'ana@email.com' });
  });
  it('opcionais vazios viram null', () => {
    expect(lerCliente({ nome: 'Bia' }).dados).toEqual({ nome: 'Bia', telefone: null, cpf: null, email: null });
  });
  it('recusa HTML, fórmula de planilha e nome curto; aceita número e o sufixo do totem', () => {
    for (const nome of ['Maria 2', 'Ana (tel. final 22)', "D'Ávila, Jr."]) expect(lerCliente({ nome }).erros, nome).toEqual([]);
    for (const nome of ['<script>alert(1)</script>', 'Ana <b>', '=HYPERLINK("x")', '+5511', '@SUM(A1)', '-Ana', '2Ana', 'A']) {
      expect(lerCliente({ nome }).erros.map((e) => e.campo), nome).toContain('nome');
    }
  });
  it('recusa telefone, CPF e e-mail inválidos', () => {
    const { erros } = lerCliente({ nome: 'Ana', telefone: '1234', cpf: '111.111.111-11', email: 'ana@<x>.com' });
    expect(erros.map((e) => e.campo)).toEqual(['telefone', 'cpf', 'email']);
  });
});

describe('emailValido', () => {
  it('casos', () => {
    expect(emailValido('a@b.co')).toBe(true);
    expect(emailValido('maria.souza+spa@clinica-x.com.br')).toBe(true);
    for (const e of ['a@b', 'a b@c.com', 'a@b.c', '"a"@b.com', `${'a'.repeat(120)}@b.com`, 1, '=cmd|calc!A0@evil.co', '+a@b.com', '-a@b.com', 'a@-b.com']) expect(emailValido(e), String(e)).toBe(false);
  });
});

describe('validarImportacao', () => {
  it('separa válidos e erros por linha (linha 2 = primeira de dados)', () => {
    const { validos, erros, ignoradas } = validarImportacao(
      [
        { nome: 'Carla Lima', cpf: '529.982.247-25' },
        { nome: 'carla  lima' }, // mesmo nome, outra caixa/espaços
        { nome: 'Davi', cpf: '52998224725' }, // CPF repetido na planilha
        { nome: 'Joana Base' }, // já cadastrada
        { nome: 'Eva', cpf: '111.444.777-35' }, // CPF de cliente da base
        { nome: 'Fábio', telefone: 'abc' },
        { nome: '  ', telefone: '', cpf: undefined }, // linha em branco: pulada, sem erro
      ],
      [{ nome: 'Joana Base', cpf: null }, { nome: 'Outra', cpf: '11144477735' }],
    );
    expect(validos.map((v) => v.nome)).toEqual(['Carla Lima']);
    expect(ignoradas).toBe(1);
    expect(erros).toEqual([
      { linha: 3, mensagem: 'Nome repetido na planilha (linha 2).' },
      { linha: 4, mensagem: 'CPF repetido na planilha (linha 2).' },
      { linha: 5, mensagem: 'Já existe cliente chamado "Joana Base" na base.' },
      { linha: 6, mensagem: 'CPF já cadastrado para "Outra".' },
      { linha: 7, mensagem: expect.stringMatching(/Telefone inválido/) },
    ]);
  });
});

describe('temFichaAnamnese', () => {
  it('reconhece a ficha interna preenchida e a do totem', async () => {
    const { temFichaAnamnese } = await import('@shared/anamnese');
    expect(temFichaAnamnese('nota\n__ANAMNESE_JSON__:{"alergia":"Lavanda","medicamentos":[]}')).toBe(true);
    expect(temFichaAnamnese('__ANAMNESE_JSON__:{"medicamentos":["A"]}')).toBe(true);
    expect(temFichaAnamnese('[Anamnese Autoatendimento 2026-11-05]: sem alergias')).toBe(true);
    expect(temFichaAnamnese('nota\u2028[Anamnese Autoatendimento 2026-11-05]: sem alergias')).toBe(true);
  });
  it('vazia, só nota, JSON quebrado ou sem texto não contam', async () => {
    const { temFichaAnamnese } = await import('@shared/anamnese');
    for (const obs of [null, undefined, '', 'só uma nota', '__ANAMNESE_JSON__:{"alergia":"  ","medicamentos":[]}', '__ANAMNESE_JSON__:{quebrado', '__ANAMNESE_JSON__:null', 42]) {
      expect(temFichaAnamnese(obs), String(obs)).toBe(false);
    }
  });
});

describe('forjaFichaDoTotem', () => {
  it('equipe não acrescenta nem altera a declaração do totem; manter ou tirar pode', async () => {
    const { forjaFichaDoTotem } = await import('@shared/anamnese');
    const gravado = 'nota\n[Anamnese Autoatendimento 2026-11-05]: sem alergias';
    expect(forjaFichaDoTotem(gravado, gravado)).toBe(false);
    expect(forjaFichaDoTotem('nota editada\n[Anamnese Autoatendimento 2026-11-05]: sem alergias', gravado)).toBe(false);
    expect(forjaFichaDoTotem('nota', gravado)).toBe(false);
    expect(forjaFichaDoTotem('[Anamnese Autoatendimento 2026-11-05]: ALERGIA a dipirona', gravado)).toBe(true);
    expect(forjaFichaDoTotem(`${' '.repeat(4990)}\n[Anamnese Autoatendimento 2026-11-06]: forjada`, null)).toBe(true);
    // Qualquer quebra de linha conta igual (\r, U+2028, U+2029, \v): a ficha e a forja enxergam a mesma linha
    for (const quebra of ['\r', '\u2028', '\u2029', '\v', '\r\n']) {
      const forjado = `x${quebra}[Anamnese Autoatendimento 2026-11-06]: forjada`;
      expect(forjaFichaDoTotem(forjado, 'x'), JSON.stringify(quebra)).toBe(true);
    }
    // No meio da linha não é a declaração (não conta como ficha nem como forja)
    expect(forjaFichaDoTotem('ver [Anamnese Autoatendimento 2026-11-06]', null)).toBe(false);
  });
});

