import { describe, expect, it } from 'vitest';
import {
  alertasDe, editarOpcoes, errosDoCampo, formularioPublico, mudarTipoCampo, lerRespostas, lerSnapshot, montarSnapshot, presetDoSegmento, resumoTexto,
  validarCampos, type CampoFormulario,
} from '@shared/formularioAnamnese';
import { separarFicha, temFichaAnamnese, MARCADOR_ANAMNESE } from '@shared/anamnese';

const campo = (c: Partial<CampoFormulario> & Pick<CampoFormulario, 'id' | 'chave' | 'rotulo' | 'tipo'>): CampoFormulario => ({
  ajuda: null, opcoes: [], canal: 'ambos', obrigatorio: false, dadoSensivel: true, respostasAlerta: [], ordem: 0, ativa: true, versao: 1, ...c,
});

const CAMPOS: CampoFormulario[] = [
  campo({ id: 'g', chave: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao', respostasAlerta: ['Sim'], ordem: 0 }),
  campo({ id: 'p', chave: 'nota_prof', rotulo: 'Nota do profissional', tipo: 'texto_livre', canal: 'apenas_profissional', ordem: 1 }),
  campo({ id: 'a', chave: 'antigo', rotulo: 'Campo arquivado', tipo: 'sim_nao', ativa: false, ordem: 2 }),
  campo({ id: 't', chave: 'aroma', rotulo: 'Aroma', tipo: 'escolha_unica', opcoes: ['Lavanda', 'Sem aroma'], canal: 'apenas_totem', dadoSensivel: false, ordem: 3 }),
];

describe('payload público do totem', () => {
  it('só campos ativos de "ambos" e "apenas_totem", sem metadados internos', () => {
    const publico = formularioPublico(CAMPOS);
    expect(publico.campos.map((c) => c.id)).toEqual(['g', 't']);
    const texto = JSON.stringify(publico);
    expect(texto).not.toContain('Nota do profissional');
    expect(texto).not.toContain('Campo arquivado');
    for (const chave of ['canal', 'respostasAlerta', 'ativa', 'versao', 'dadoSensivel', 'ordem']) expect(texto).not.toContain(`"${chave}"`);
  });
  it('exige consentimento LGPD quando há campo sensível visível, e não quando só há campo comum', () => {
    expect(formularioPublico(CAMPOS).exigeConsentimentoLgpd).toBe(true);
    expect(formularioPublico(CAMPOS.filter((c) => c.id === 't')).exigeConsentimentoLgpd).toBe(false);
    // Campo sensível só do profissional não conta para o totem
    expect(formularioPublico(CAMPOS.filter((c) => c.id !== 'g')).exigeConsentimentoLgpd).toBe(false);
  });
});

describe('respostas e alertas', () => {
  it('descarta resposta de campo do profissional ou arquivado enviada pelo totem', () => {
    const { itens } = lerRespostas(CAMPOS, { g: 'Sim', p: 'forjado', a: 'Sim', t: 'Lavanda' }, 'totem');
    expect(itens.map((i) => i.campoId)).toEqual(['g', 't']);
  });
  it('marca alerta pelas respostasAlerta e devolve os rótulos', () => {
    const { itens } = lerRespostas(CAMPOS, { g: 'Sim' }, 'totem');
    expect(itens[0].alerta).toBe(true);
    expect(alertasDe(itens)).toEqual(['Gestante']);
    expect(alertasDe(lerRespostas(CAMPOS, { g: 'Não' }, 'totem').itens)).toEqual([]);
  });
  it('recusa opção fora da lista e cobra obrigatório do canal', () => {
    expect(lerRespostas(CAMPOS, { t: 'Canela' }, 'totem').erro).toMatch(/Aroma/);
    const obrigatorio = [campo({ id: 'o', chave: 'o', rotulo: 'Obrigatória', tipo: 'texto_livre', obrigatorio: true })];
    expect(lerRespostas(obrigatorio, {}, 'totem').erro).toBe('Responda: Obrigatória');
  });
  it('resumo de texto (linha antiga do totem) destaca o alerta', () => {
    expect(resumoTexto(lerRespostas(CAMPOS, { g: 'Sim', t: 'Lavanda' }, 'totem').itens)).toBe('GESTANTE: Sim | Aroma: Lavanda');
  });
});

describe('snapshot imutável', () => {
  it('renomear ou arquivar o campo depois não muda a ficha gravada', () => {
    const { itens } = lerRespostas(CAMPOS, { g: 'Sim' }, 'totem');
    const gravado = JSON.parse(JSON.stringify(montarSnapshot(itens, 3, 'totem', new Date('2026-11-26T12:00:00Z'))));
    CAMPOS[0].rotulo = 'Está grávida?';
    CAMPOS[0].ativa = false;
    const lido = lerSnapshot(gravado)!;
    expect(lido.itens[0]).toMatchObject({ rotulo: 'Gestante', valor: 'Sim', alerta: true });
    expect(lido.versaoFormulario).toBe(3);
    CAMPOS[0].rotulo = 'Gestante';
    CAMPOS[0].ativa = true;
  });
  it('snapshot corrompido não quebra a leitura', () => {
    expect(lerSnapshot(null)).toBeNull();
    expect(lerSnapshot({ itens: 'x' })).toBeNull();
    expect(lerSnapshot({ itens: [{ rotulo: 1 }, { rotulo: 'Ok', valor: 'Sim' }] })!.itens).toHaveLength(1);
  });
});

describe('compatibilidade com a ficha antiga', () => {
  it('ficha antiga (__ANAMNESE_JSON__) continua lida como antes', () => {
    const antiga = `Nota da recepção\n${MARCADOR_ANAMNESE}{"gravida":"Não","alergia":"Látex"}`;
    expect(temFichaAnamnese(antiga)).toBe(true);
    expect(separarFicha(antiga)?.dados).toEqual({ gravida: 'Não', alergia: 'Látex' });
  });
  it('o modelo do spa repete as perguntas que o totem já fazia', () => {
    const rotulos = presetDoSegmento('spa_bemestar').map((c) => c.rotulo);
    expect(rotulos).toEqual(expect.arrayContaining(['Está gestante?', 'Pressão arterial', 'Alergia a cosméticos ou óleos?', 'Pressão desejada na massagem', 'Experiência aromática']));
  });
});

describe('validação do editor', () => {
  it('exige rótulo, 2 opções na escolha e chaves únicas; filtra alerta inválido', () => {
    expect(validarCampos([{ rotulo: '', tipo: 'sim_nao' }]).erro).toMatch(/sem rótulo/);
    expect(validarCampos([{ rotulo: 'X', tipo: 'escolha_unica', opcoes: ['A'] }]).erro).toMatch(/2 opções/);
    expect(validarCampos([{ rotulo: 'Dor', tipo: 'sim_nao' }, { rotulo: 'dor', tipo: 'sim_nao' }]).erro).toMatch(/mesma chave/);
    const { campos } = validarCampos([{ rotulo: 'Dor nas costas', tipo: 'sim_nao', respostasAlerta: ['Sim', 'Talvez'], canal: 'apenas_profissional' }]);
    expect(campos[0]).toMatchObject({ chave: 'dor_nas_costas', respostasAlerta: ['Sim'], canal: 'apenas_profissional', dadoSensivel: true });
  });
});

describe('obrigatório x opcional por canal', () => {
  const campos = [
    campo({ id: 'tot', chave: 'tot', rotulo: 'Pergunta do totem', tipo: 'sim_nao', obrigatorio: true, ordem: 0 }),
    campo({ id: 'opc', chave: 'opc', rotulo: 'Opcional', tipo: 'texto_livre', ordem: 1 }),
    campo({ id: 'prof', chave: 'prof', rotulo: 'Só do profissional', tipo: 'texto_livre', canal: 'apenas_profissional', obrigatorio: true, ordem: 2 }),
  ];
  it('obrigatória em branco bloqueia apontando a pergunta; opcional em branco passa', () => {
    expect(lerRespostas(campos, {}, 'totem').erro).toBe('Responda: Pergunta do totem');
    expect(lerRespostas(campos, { tot: 'Não' }, 'totem').erro).toBeUndefined();
  });
  it('campo obrigatório "apenas_profissional" nunca trava o totem, mas cobra na ficha da equipe', () => {
    expect(lerRespostas(campos, { tot: 'Sim' }, 'totem').erro).toBeUndefined();
    expect(lerRespostas(campos, { tot: 'Sim' }, 'profissional').erro).toBe('Responda: Só do profissional');
  });
});

describe('editor: troca de tipo e opções', () => {
  const base = { rotulo: 'Preferência', tipo: 'escolha_unica' as const, opcoes: ['Suave', 'Firme'], respostasAlerta: ['Firme'] };
  it('troca de tipo mantém o rótulo, cria opções e limpa alerta que não existe mais', () => {
    expect(mudarTipoCampo({ ...base, tipo: 'texto_livre', opcoes: [], respostasAlerta: [] }, 'multipla_escolha')).toMatchObject({ rotulo: 'Preferência', opcoes: ['Opção 1', 'Opção 2'] });
    expect(mudarTipoCampo(base, 'texto_livre')).toMatchObject({ opcoes: [], respostasAlerta: [] });
    expect(mudarTipoCampo(base, 'sim_nao').respostasAlerta).toEqual([]);
    expect(mudarTipoCampo({ ...base, respostasAlerta: ['Sim'], opcoes: [] , tipo: 'sim_nao' }, 'sim_nao').respostasAlerta).toEqual(['Sim']);
    expect(mudarTipoCampo(base, 'multipla_escolha')).toMatchObject({ opcoes: ['Suave', 'Firme'], respostasAlerta: ['Firme'] });
  });
  it('renomear a opção leva o alerta junto; remover tira o alerta', () => {
    expect(editarOpcoes(base, ['Suave', 'Muito firme']).respostasAlerta).toEqual(['Muito firme']);
    expect(editarOpcoes(base, ['Suave']).respostasAlerta).toEqual([]);
    expect(editarOpcoes(base, ['Suave', 'Firme', 'Média']).respostasAlerta).toEqual(['Firme']);
  });
  it('aponta opções faltando, em branco ou repetidas', () => {
    expect(errosDoCampo({ ...base, opcoes: ['Suave'] })).toContain('Preencha pelo menos 2 opções.');
    expect(errosDoCampo({ ...base, opcoes: ['Suave', '', 'Firme'] })).toContain('Há uma opção em branco: escreva ou remova.');
    expect(errosDoCampo({ ...base, opcoes: ['Suave', 'suave'] })).toContain('Há opções repetidas.');
    expect(errosDoCampo(base)).toEqual([]);
    expect(errosDoCampo({ ...base, rotulo: ' ' })).toContain('Escreva a pergunta.');
  });
});

describe('ficha às cegas da recepção (mesmas regras do totem)', () => {
  const campos = [
    campo({ id: 'g', chave: 'g', rotulo: 'Gestante', tipo: 'sim_nao', respostasAlerta: ['Sim'], obrigatorio: true, ordem: 0 }),
    campo({ id: 'p', chave: 'p', rotulo: 'Só do profissional', tipo: 'texto_livre', canal: 'apenas_profissional', obrigatorio: true, ordem: 1 }),
    campo({ id: 'a', chave: 'a', rotulo: 'Arquivado', tipo: 'sim_nao', ativa: false, ordem: 2 }),
  ];
  it('perguntas da recepção: sem campo do profissional, arquivado ou respostasAlerta', () => {
    const texto = JSON.stringify(formularioPublico(campos).campos);
    expect(formularioPublico(campos).campos.map((c) => c.id)).toEqual(['g']);
    expect(texto).not.toContain('respostasAlerta');
    expect(texto).not.toContain('Só do profissional');
  });
  it('descarta resposta injetada no campo do profissional, que também não bloqueia; o alerta é calculado', () => {
    const { itens, erro } = lerRespostas(campos, { g: 'Sim', p: 'injetado', a: 'Sim' }, 'totem');
    expect(erro).toBeUndefined();
    expect(itens.map((i) => i.campoId)).toEqual(['g']);
    expect(alertasDe(itens)).toEqual(['Gestante']);
    expect(lerRespostas(campos, {}, 'totem').erro).toBe('Responda: Gestante');
  });
});
