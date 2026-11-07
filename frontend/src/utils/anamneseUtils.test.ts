import { describe, expect, it } from 'vitest';
import { MARCADOR_ANAMNESE, aparaObservacao, atualizarSomenteFichaJson, fichaPreenchida, forjaFichaDoTotem, separarFicha, temFichaAnamnese } from '@shared/anamnese';
import { fichaOculta, formatAnamneseStorage, parseClientObservation } from './anamneseUtils';
import { initialAnamnese } from '../components/AnamneseForm';

describe('parseClientObservation', () => {
  const totem = '[Anamnese Autoatendimento 2026-11-01]: alergia a lavanda';

  it('mostra a ficha do totem no resumo (antes vinha vazia) e mantém a linha na nota', () => {
    const r = parseClientObservation(`prefere manhã\n${totem}`);
    expect(r.anamSummary).toEqual([totem]);
    expect(r.note).toContain(totem);
  });

  it('junta ficha interna e do totem', () => {
    const obs = `${totem}\n${MARCADOR_ANAMNESE}${JSON.stringify({ ...initialAnamnese, queixa: 'lombar' })}`;
    const r = parseClientObservation(obs);
    expect(r.anamSummary).toEqual(['Queixa: lombar', totem]);
    expect(r.anamData.queixa).toBe('lombar');
    // Regravar não perde a linha do totem
    expect(formatAnamneseStorage(r.note, r.anamData)).toContain(totem);
  });

  it('sem ficha: resumo vazio', () => {
    expect(parseClientObservation('só uma nota').anamSummary).toEqual([]);
    expect(parseClientObservation(undefined).anamSummary).toEqual([]);
  });
});

describe('parseClientObservation: mesma regra de linha da API', () => {
  const totem = '[Anamnese Autoatendimento 2026-11-01]: alergia a lavanda';

  it('tudo que temFichaAnamnese conta como totem aparece no resumo', () => {
    for (const obs of [`nota\r\n${totem}`, `nota\r${totem}`, `nota\v${totem}`, `nota\u2028${totem}`, `nota\u0085${totem}`]) {
      expect(temFichaAnamnese(obs), JSON.stringify(obs)).toBe(true);
      expect(parseClientObservation(obs).anamSummary, JSON.stringify(obs)).toEqual([totem]);
    }
  });

  it('linha com espaço antes do prefixo não é ficha do totem (nem na API, nem na tela)', () => {
    const obs = `  ${totem}`;
    expect(temFichaAnamnese(obs)).toBe(false);
    expect(parseClientObservation(obs).anamSummary).toEqual([]);
  });
});

describe('parseClientObservation: totem gravado depois da ficha da equipe', () => {
  const totem = '[Anamnese Autoatendimento 2026-11-01]: alergia a lavanda';
  const json = `${MARCADOR_ANAMNESE}${JSON.stringify({ ...initialAnamnese, queixa: 'lombar' })}`;

  it('mostra as duas fichas e regravar mantém o totem com um marcador só', () => {
    const r = parseClientObservation(`nota\n${json}\n${totem}`);
    expect(r.anamSummary).toEqual(['Queixa: lombar', totem]);
    expect(r.anamData.queixa).toBe('lombar');
    const gravado = formatAnamneseStorage(r.note, r.anamData);
    expect(gravado.split(MARCADOR_ANAMNESE)).toHaveLength(2);
    expect(gravado).toContain(totem);
    expect(gravado.startsWith('nota')).toBe(true);
  });

  it('JSON quebrado: resumo só com o totem, nada se perde da nota', () => {
    const r = parseClientObservation(`nota\n${MARCADOR_ANAMNESE}{quebrado\n${totem}`);
    expect(r.anamSummary).toEqual([totem]);
    expect(r.note).toContain('{quebrado');
  });
});

describe('separarFicha: regra única da API e da tela', () => {
  // JSON.stringify não escapa U+2028/U+2029/NEL (só < 0x20): texto colado de Word/PDF pode trazê-los num campo
  for (const [rotulo, q] of [['U+2028', '\u2028'], ['U+2029', '\u2029'], ['NEL', '\u0085']] as const) {
    it(`${rotulo} dentro de um campo: a ficha continua lida e regravar não duplica o marcador`, () => {
      const obs = formatAnamneseStorage('nota', { ...initialAnamnese, alergia: `Lavanda${q}Rosa`, queixa: 'lombar' });
      expect(temFichaAnamnese(obs)).toBe(true);
      const r = parseClientObservation(obs);
      expect(r.anamSummary).toContain('Queixa: lombar');
      const regravado = formatAnamneseStorage(r.note, { ...r.anamData, profissao: 'x' });
      expect(regravado.split(MARCADOR_ANAMNESE)).toHaveLength(2);
      expect(temFichaAnamnese(regravado)).toBe(true);
    });
  }

  it('API e tela concordam com nota depois do JSON (antes a API dizia "sem ficha")', () => {
    const obs = `nota\n${MARCADOR_ANAMNESE}{"queixa":"x"}\nlembrar de ligar`;
    expect(temFichaAnamnese(obs)).toBe(true);
    expect(separarFicha(obs)?.nota).toBe('nota\nlembrar de ligar');
  });

  it('marcador com JSON quebrado ou vazio: sem ficha, o texto fica intacto', () => {
    expect(separarFicha(`nota\n${MARCADOR_ANAMNESE}{quebrado`)).toEqual({ nota: `nota\n${MARCADOR_ANAMNESE}{quebrado`, json: '', dados: null });
    expect(temFichaAnamnese(`nota\n${MARCADOR_ANAMNESE}`)).toBe(false);
  });

  // Regravar põe a ficha nova por último, e vale a última: antes a API seguia lendo a 1ª e a ficha nova não valia
  for (const [rotulo, obs] of [
    ['JSON quebrado', `nota\n${MARCADOR_ANAMNESE}{quebrado`],
    ['marcador vazio', `nota\n${MARCADOR_ANAMNESE}`],
    ['dois marcadores válidos', `nota\n${MARCADOR_ANAMNESE}{"alergia":"x"}\n${MARCADOR_ANAMNESE}{"alergia":"velha"}`],
    // Ataque da banca: tirar o marcador do texto remontava outro e a correção da alergia se perdia
    ['marcador aninhado', `${MARCADOR_ANAMNESE}{"alergia":"nenhuma"}\n__ANAMNESE___ANAMNESE___ANAMNESE_JSON__:JSON__:JSON__:{"alergia":"nenhuma"}`],
  ] as const) {
    it(`${rotulo}: preencher/alterar e regravar vale a ficha nova, sem mexer no resto do texto`, () => {
      const r = parseClientObservation(obs);
      const regravado = formatAnamneseStorage(r.note, { ...r.anamData, alergia: 'nova' });
      expect(temFichaAnamnese(regravado)).toBe(true);
      expect(parseClientObservation(regravado).anamData.alergia).toBe('nova');
      expect(regravado.startsWith(aparaObservacao(r.note))).toBe(true);
      // Regravar de novo também vale (não acumula efeito)
      const r2 = parseClientObservation(regravado);
      expect(parseClientObservation(formatAnamneseStorage(r2.note, { ...r2.anamData, alergia: 'outra' })).anamData.alergia).toBe('outra');
    });
  }

  // Texto do cliente no totem não é filtrado: o marcador dentro dele é texto, nunca ficha da equipe
  for (const [rotulo, obs] of [
    ['totem com o marcador no texto', `[Anamnese Autoatendimento 2026-11-01]: ${MARCADOR_ANAMNESE}x`],
    ['totem com marcador+JSON no texto', `[Anamnese Autoatendimento 2026-11-01]: ${MARCADOR_ANAMNESE}{"alergia":"nenhuma"}`],
    ['totem com marcador + ficha da equipe depois', `[Anamnese Autoatendimento 2026-11-01]: ${MARCADOR_ANAMNESE}x\n${MARCADOR_ANAMNESE}{"queixa":"lombar"}`],
  ] as const) {
    it(`${rotulo}: a linha do totem não muda ao regravar (sem 400 de forja) e não vira ficha da equipe`, () => {
      const r = parseClientObservation(obs);
      expect(r.anamSummary).not.toContain('Alergias: nenhuma');
      const regravado = formatAnamneseStorage(r.note, { ...r.anamData, profissao: 'x' });
      expect(forjaFichaDoTotem(regravado, obs)).toBe(false);
      expect(temFichaAnamnese(regravado)).toBe(true);
    });
  }

  it('não apara o começo da linha que volta para a nota (não vira linha do totem)', () => {
    const obs = `nota\n${MARCADOR_ANAMNESE}{"queixa":"x"}\n  [Anamnese Autoatendimento 2020-01-01]: y`;
    expect(separarFicha(obs)?.nota).toBe('nota\n  [Anamnese Autoatendimento 2020-01-01]: y');
    expect(parseClientObservation(obs).anamSummary).toEqual(['Queixa: x']);
  });

  it('marcador quebrado antes de uma ficha válida: a válida vale e o texto fica', () => {
    const obs = `nota ${MARCADOR_ANAMNESE} obs\n${MARCADOR_ANAMNESE}{"alergia":"x"}`;
    expect(temFichaAnamnese(obs)).toBe(true);
    expect(separarFicha(obs)?.nota).toBe(`nota ${MARCADOR_ANAMNESE} obs`);
  });

  it('pior caso: marcadores quebrados numa linha só ou um por linha, bem acima do limite, é rápido (linear)', () => {
    for (const obs of [`${MARCADOR_ANAMNESE}{"a":"`.repeat(4000), `${MARCADOR_ANAMNESE}{"a":"\n`.repeat(4000)]) {
      const inicio = performance.now();
      expect(temFichaAnamnese(obs)).toBe(false);
      // ~100 kB: a leitura quadrática anterior levava segundos; linear, poucos ms (folga para máquina carregada)
      expect(performance.now() - inicio).toBeLessThan(500);
    }
  });

  // Totem público: o texto do cliente com NEL (ou outra quebra que não seja \r/\n) antes do marcador virava ficha
  // "da equipe". O marcador só vale no começo de uma linha separada por \r ou \n
  for (const [rotulo, q] of [['NEL', '\u0085'], ['U+2028', '\u2028'], ['U+2029', '\u2029'], ['\\v', '\v'], ['\\f', '\f']] as const) {
    it(`totem com ${rotulo} antes do marcador: não vira ficha da equipe`, () => {
      const obs = `[Anamnese Autoatendimento 2026-11-01]: nada${q}${MARCADOR_ANAMNESE}{"alergia":"nenhuma"}`;
      expect(separarFicha(obs)?.dados).toBeNull();
      expect(parseClientObservation(obs).anamSummary).not.toContain('Alergias: nenhuma');
    });
  }

  it('marcador no meio de uma linha da equipe não é ficha (a tela sempre grava no começo da linha)', () => {
    expect(temFichaAnamnese(`nota ${MARCADOR_ANAMNESE}{"alergia":"x"}`)).toBe(false);
    expect(temFichaAnamnese(`nota\n${MARCADOR_ANAMNESE}{"alergia":"x"}`)).toBe(true);
    expect(temFichaAnamnese(`nota\r\n${MARCADOR_ANAMNESE}{"alergia":"x"}`)).toBe(true);
  });

  // Aceito como BAIXO: duas fichas no texto só entram pela API (inclusive a recepção, num cliente sem ficha, com a
  // obrigatória ligada). O que volta é a ficha de quem gravou a anterior, nunca o dado do profissional; com a
  // obrigatória ligada, limpar a ficha já é recusado. A base real não tem esse caso
  it('ficha antiga válida no texto volta a valer se a atual for limpa', () => {
    const obs = `nota\n${MARCADOR_ANAMNESE}{"queixa":"velha"}\n${MARCADOR_ANAMNESE}{"queixa":"nova"}`;
    const r = parseClientObservation(obs);
    expect(r.anamData.queixa).toBe('nova');
    expect(parseClientObservation(formatAnamneseStorage(r.note, initialAnamnese)).anamData.queixa).toBe('velha');
  });
});

describe('fichaOculta', () => {
  it('só esconde quando há ficha e a API não deu acesso', () => {
    expect(fichaOculta({ temAnamnese: true, acessoSaude: false })).toBe(true);
    expect(fichaOculta({ temAnamnese: true, acessoSaude: undefined })).toBe(true);
    expect(fichaOculta({ temAnamnese: true, acessoSaude: true })).toBe(false);
    expect(fichaOculta({ temAnamnese: false, acessoSaude: false })).toBe(false);
  });
});

describe('formatAnamneseStorage: não apara o começo das linhas', () => {
  const quase = '  [Anamnese Autoatendimento 2020-01-01]: y';

  it('nota que começa com "  [Anamnese ..." continua não sendo linha do totem ao gravar', () => {
    const r = parseClientObservation(quase);
    const gravado = formatAnamneseStorage(r.note, { ...initialAnamnese, queixa: 'x' });
    expect(gravado.startsWith(quase)).toBe(true);
    expect(forjaFichaDoTotem(gravado, quase)).toBe(false);
  });

  it('tira só linhas em branco do começo e espaços do fim', () => {
    expect(formatAnamneseStorage('\n\n  nota  \n', initialAnamnese)).toBe('  nota');
    expect(formatAnamneseStorage('', { ...initialAnamnese, queixa: 'x' })).toBe(`${MARCADOR_ANAMNESE}${JSON.stringify({ ...initialAnamnese, queixa: 'x' })}`);
  });
});

describe('Segurança e integridade da ficha (Itens 8 e 17 / A2)', () => {
  it('rejeita JSON com chaves desconhecidas ou tipos inválidos em fichaPreenchida', () => {
    expect(fichaPreenchida({ x: 1 })).toBe(false);
    expect(fichaPreenchida({ caracteristicas: 123 })).toBe(false);
    expect(fichaPreenchida({ caracteristicas: ['Asma', 123] })).toBe(false);
    expect(fichaPreenchida({ queixa: { invalido: true } })).toBe(false);
    expect(fichaPreenchida({ queixa: 'Dor lombar', caracteristicas: ['Cansaço'] })).toBe(true);
  });

  it('normaliza tipos malformados no parseClientObservation sem crashar .join()', () => {
    const malicioso = `${MARCADOR_ANAMNESE}{"queixa":"lombar","caracteristicas":123,"medicamentos":"nenhum"}`;
    // Como caracteristicas/medicamentos têm tipo inválido, separarFicha trata como JSON inválido (dados: null)
    const parsed = parseClientObservation(malicioso);
    expect(Array.isArray(parsed.anamData.caracteristicas)).toBe(true);
    expect(Array.isArray(parsed.anamData.medicamentos)).toBe(true);
  });

  it('atualizarSomenteFichaJson substitui apenas o bloco JSON preservando nota médica e linha do totem', () => {
    const totem = '[Anamnese Autoatendimento 2026-11-01]: gestante';
    const anterior = `Nota da supervisão\n${totem}\n${MARCADOR_ANAMNESE}{"alergia":"Lavanda"}`;
    const envioRecepcao = `Tentativa de injetar nota\n${MARCADOR_ANAMNESE}{"alergia":"Camomila","queixa":"Relaxamento"}`;
    const atualizado = atualizarSomenteFichaJson(anterior, envioRecepcao);
    expect(atualizado).not.toBeNull();
    expect(atualizado).toContain('Nota da supervisão');
    expect(atualizado).toContain(totem);
    expect(atualizado).not.toContain('Tentativa de injetar nota');
    expect(parseClientObservation(atualizado!).anamData.alergia).toBe('Camomila');
  });
});

describe('resumo e API contam os mesmos campos', () => {
  for (const dados of [{ alergia: 0 }, { gravida: false }, { alergia: '' }, { alergia: [] }, { alergia: null }]) {
    it(JSON.stringify(dados), () => {
      const obs = `${MARCADOR_ANAMNESE}${JSON.stringify(dados)}`;
      expect(parseClientObservation(obs).anamSummary.length > 0).toBe(temFichaAnamnese(obs));
    });
  }
});
