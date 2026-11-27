// Formulário de anamnese configurável: regras únicas da API, do totem e da ficha da equipe.
// A ficha preenchida guarda uma cópia (snapshot) das perguntas e respostas: renomear ou arquivar um campo depois
// não muda o que já foi respondido.

export const TIPOS_CAMPO = ['sim_nao', 'escolha_unica', 'multipla_escolha', 'texto_livre'] as const;
export const CANAIS_CAMPO = ['ambos', 'apenas_totem', 'apenas_profissional'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export type CanalCampo = (typeof CANAIS_CAMPO)[number];
export type CanalFicha = 'totem' | 'profissional';

export type CampoFormulario = {
  id: string;
  chave: string;
  rotulo: string;
  ajuda: string | null;
  tipo: TipoCampo;
  opcoes: string[];
  canal: CanalCampo;
  obrigatorio: boolean;
  dadoSensivel: boolean;
  respostasAlerta: string[];
  ordem: number;
  ativa: boolean;
  versao?: number;
};

// O que o totem público recebe: sem canal, arquivamento, regra de alerta nem versão
export type CampoPublico = Pick<CampoFormulario, 'id' | 'chave' | 'rotulo' | 'ajuda' | 'tipo' | 'opcoes' | 'obrigatorio'>;
export type ValorResposta = string | string[];
export type ItemFicha = {
  campoId: string; chave: string; rotulo: string; tipo: TipoCampo; valor: ValorResposta; alerta: boolean; dadoSensivel: boolean;
};
export type SnapshotFicha = {
  versaoFormulario: number; preenchidoEm: string; preenchidoPorCanal: CanalFicha; itens: ItemFicha[];
};

export const OPCOES_SIM_NAO = ['Sim', 'Não'];
export const LIMITE_TEXTO_RESPOSTA = 500;
export const MAX_CAMPOS = 60;
const LIMITE_ROTULO = 120;
const LIMITE_AJUDA = 200;
const LIMITE_OPCAO = 80;
const MAX_OPCOES = 20;

export const opcoesDoCampo = (campo: Pick<CampoFormulario, 'tipo' | 'opcoes'>) => (campo.tipo === 'sim_nao' ? OPCOES_SIM_NAO : campo.opcoes);

const visivelNoCanal = (canal: CanalCampo, ficha: CanalFicha) => canal === 'ambos' || canal === (ficha === 'totem' ? 'apenas_totem' : 'apenas_profissional');

/** Campos ativos que aparecem no totem ou na ficha da equipe, na ordem do formulário. */
export const camposDoCanal = <T extends Pick<CampoFormulario, 'canal' | 'ativa' | 'ordem'>>(campos: T[], ficha: CanalFicha) =>
  campos.filter((c) => c.ativa && visivelNoCanal(c.canal, ficha)).sort((a, b) => a.ordem - b.ordem);

// Lista branca explícita: um campo novo no banco não vaza para o totem sem passar por aqui
export const paraPublico = (c: CampoFormulario): CampoPublico => ({
  id: c.id, chave: c.chave, rotulo: c.rotulo, ajuda: c.ajuda, tipo: c.tipo, opcoes: [...opcoesDoCampo(c)], obrigatorio: c.obrigatorio,
});

export const exigeConsentimentoLgpd = (campos: Pick<CampoFormulario, 'dadoSensivel'>[]) => campos.some((c) => c.dadoSensivel);

export const formularioPublico = (campos: CampoFormulario[]) => {
  const doTotem = camposDoCanal(campos, 'totem');
  return { campos: doTotem.map(paraPublico), exigeConsentimentoLgpd: exigeConsentimentoLgpd(doTotem) };
};

const valorVazio = (v: ValorResposta | undefined) => (Array.isArray(v) ? v.length === 0 : !v);

/**
 * Lê as respostas enviadas ({ [campoId]: valor }) só para os campos visíveis no canal: resposta de campo de outro
 * canal, arquivado ou desconhecido é descartada (o totem não grava pergunta exclusiva do profissional).
 */
export const lerRespostas = (campos: CampoFormulario[], entrada: unknown, ficha: CanalFicha): { itens: ItemFicha[]; erro?: string } => {
  const respostas = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const itens: ItemFicha[] = [];
  for (const campo of camposDoCanal(campos, ficha)) {
    const bruto = respostas[campo.id];
    const opcoes = opcoesDoCampo(campo);
    let valor: ValorResposta | undefined;
    if (campo.tipo === 'texto_livre') {
      if (bruto !== undefined && bruto !== null && typeof bruto !== 'string') return { itens: [], erro: `Resposta inválida em "${campo.rotulo}".` };
      valor = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : '';
      if (valor.length > LIMITE_TEXTO_RESPOSTA) return { itens: [], erro: `"${campo.rotulo}" aceita no máximo ${LIMITE_TEXTO_RESPOSTA} caracteres.` };
    } else if (campo.tipo === 'multipla_escolha') {
      if (bruto !== undefined && bruto !== null && !(Array.isArray(bruto) && bruto.every((v) => typeof v === 'string' && opcoes.includes(v)))) {
        return { itens: [], erro: `Resposta inválida em "${campo.rotulo}".` };
      }
      valor = opcoes.filter((o) => Array.isArray(bruto) && bruto.includes(o));
    } else {
      if (bruto !== undefined && bruto !== null && bruto !== '' && !(typeof bruto === 'string' && opcoes.includes(bruto))) {
        return { itens: [], erro: `Resposta inválida em "${campo.rotulo}".` };
      }
      valor = typeof bruto === 'string' ? bruto : '';
    }
    if (valorVazio(valor)) {
      if (campo.obrigatorio) return { itens: [], erro: `Responda: ${campo.rotulo}` };
      continue;
    }
    const marcados = Array.isArray(valor) ? valor : [valor];
    itens.push({
      campoId: campo.id, chave: campo.chave, rotulo: campo.rotulo, tipo: campo.tipo, valor,
      alerta: marcados.some((v) => campo.respostasAlerta.includes(v)), dadoSensivel: campo.dadoSensivel,
    });
  }
  return { itens };
};

export const montarSnapshot = (itens: ItemFicha[], versaoFormulario: number, canal: CanalFicha, agora = new Date()): SnapshotFicha => ({
  versaoFormulario, preenchidoEm: agora.toISOString(), preenchidoPorCanal: canal, itens,
});

export const alertasDe = (itens: Pick<ItemFicha, 'alerta' | 'rotulo'>[]) => itens.filter((i) => i.alerta).map((i) => i.rotulo);

export const textoDoValor = (v: ValorResposta) => (Array.isArray(v) ? v.join(', ') : v);

/** Linha legada do totem ("Rótulo: valor | ..."): quem ainda lê Agendamento.observacoesSaude continua lendo. */
export const resumoTexto = (itens: ItemFicha[]) => itens.map((i) => `${i.alerta ? i.rotulo.toUpperCase() : i.rotulo}: ${textoDoValor(i.valor)}`).join(' | ');

/** Lê um snapshot gravado. Defensivo: ficha corrompida ou de formato desconhecido vira null (não quebra a tela). */
export const lerSnapshot = (json: unknown): SnapshotFicha | null => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const s = json as Record<string, unknown>;
  if (!Array.isArray(s.itens)) return null;
  const itens = s.itens.flatMap((i): ItemFicha[] => {
    if (!i || typeof i !== 'object') return [];
    const item = i as Record<string, unknown>;
    const valor = Array.isArray(item.valor) ? item.valor.filter((v): v is string => typeof v === 'string') : typeof item.valor === 'string' ? item.valor : null;
    if (typeof item.rotulo !== 'string' || valor === null) return [];
    return [{
      campoId: String(item.campoId ?? ''), chave: String(item.chave ?? ''), rotulo: item.rotulo,
      tipo: (TIPOS_CAMPO as readonly string[]).includes(item.tipo as string) ? item.tipo as TipoCampo : 'texto_livre',
      valor, alerta: item.alerta === true, dadoSensivel: item.dadoSensivel !== false,
    }];
  });
  return {
    versaoFormulario: typeof s.versaoFormulario === 'number' ? s.versaoFormulario : 0,
    preenchidoEm: typeof s.preenchidoEm === 'string' ? s.preenchidoEm : '',
    preenchidoPorCanal: s.preenchidoPorCanal === 'totem' ? 'totem' : 'profissional',
    itens,
  };
};

export type CampoNovo = Omit<CampoFormulario, 'id' | 'ativa' | 'versao' | 'ordem'>;

const limpo = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const slugDe = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export type CampoEditado = Omit<CampoFormulario, 'versao' | 'id'> & { id: string | null };

/** Valida a lista enviada pelo editor (PUT). id null = campo novo. A ordem é a posição na lista. */
export const validarCampos = (entrada: unknown): { campos: CampoEditado[]; erro?: string } => {
  if (!Array.isArray(entrada)) return { campos: [], erro: 'Envie a lista de campos do formulário.' };
  if (entrada.length > MAX_CAMPOS) return { campos: [], erro: `O formulário aceita no máximo ${MAX_CAMPOS} campos.` };
  const campos: CampoEditado[] = [];
  const chaves = new Set<string>();
  for (const [indice, bruto] of entrada.entries()) {
    const c = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const rotulo = limpo(c.rotulo, LIMITE_ROTULO);
    if (!rotulo) return { campos: [], erro: `O campo ${indice + 1} está sem rótulo.` };
    const tipo = c.tipo as TipoCampo;
    if (!TIPOS_CAMPO.includes(tipo)) return { campos: [], erro: `Tipo inválido em "${rotulo}".` };
    const canal = (c.canal ?? 'ambos') as CanalCampo;
    if (!CANAIS_CAMPO.includes(canal)) return { campos: [], erro: `Visibilidade inválida em "${rotulo}".` };
    const opcoes = tipo === 'escolha_unica' || tipo === 'multipla_escolha'
      ? [...new Set((Array.isArray(c.opcoes) ? c.opcoes : []).map((o) => limpo(o, LIMITE_OPCAO)).filter(Boolean))]
      : [];
    if ((tipo === 'escolha_unica' || tipo === 'multipla_escolha') && opcoes.length < 2) return { campos: [], erro: `"${rotulo}" precisa de pelo menos 2 opções.` };
    if (opcoes.length > MAX_OPCOES) return { campos: [], erro: `"${rotulo}" aceita no máximo ${MAX_OPCOES} opções.` };
    const validas = tipo === 'sim_nao' ? OPCOES_SIM_NAO : opcoes;
    const respostasAlerta = tipo === 'texto_livre' ? [] : (Array.isArray(c.respostasAlerta) ? c.respostasAlerta : []).filter((r): r is string => typeof r === 'string' && validas.includes(r));
    const chave = slugDe(typeof c.chave === 'string' && c.chave ? c.chave : rotulo) || `campo_${indice + 1}`;
    if (chaves.has(chave)) return { campos: [], erro: `Há dois campos com a mesma chave ("${chave}"). Mude o rótulo de um deles.` };
    chaves.add(chave);
    campos.push({
      id: typeof c.id === 'string' && c.id ? c.id : null, chave, rotulo, ajuda: limpo(c.ajuda, LIMITE_AJUDA) || null, tipo, opcoes, canal,
      obrigatorio: c.obrigatorio === true, dadoSensivel: c.dadoSensivel !== false, respostasAlerta, ordem: indice, ativa: c.ativa !== false,
    });
  }
  return { campos };
};

// Partes estruturais: mudar qualquer uma delas cria uma nova versão do formulário
export const assinaturaEstrutural = (c: Omit<CampoFormulario, 'id' | 'versao'>) =>
  JSON.stringify([c.chave, c.rotulo, c.ajuda, c.tipo, c.opcoes, c.canal, c.obrigatorio, c.dadoSensivel, c.respostasAlerta, c.ordem, c.ativa]);

const simNao = (chave: string, rotulo: string, ajuda: string | null, alerta = true, dadoSensivel = true): CampoNovo => ({
  chave, rotulo, ajuda, tipo: 'sim_nao', opcoes: [], canal: 'ambos', obrigatorio: false, dadoSensivel, respostasAlerta: alerta ? ['Sim'] : [],
});
const escolha = (chave: string, rotulo: string, ajuda: string | null, opcoes: string[], respostasAlerta: string[] = [], dadoSensivel = true): CampoNovo => ({
  chave, rotulo, ajuda, tipo: 'escolha_unica', opcoes, canal: 'ambos', obrigatorio: false, dadoSensivel, respostasAlerta,
});
const texto = (chave: string, rotulo: string, ajuda: string | null, dadoSensivel = true): CampoNovo => ({
  chave, rotulo, ajuda, tipo: 'texto_livre', opcoes: [], canal: 'ambos', obrigatorio: false, dadoSensivel, respostasAlerta: [],
});

const SAUDE: CampoNovo[] = [
  simNao('gestante', 'Está gestante?', 'Requer cuidados de postura e óleos seguros'),
  escolha('pressao_arterial', 'Pressão arterial', 'Para ajuste térmico e intensidade', ['Normal', 'Alta', 'Baixa'], ['Alta']),
  simNao('cirurgia_recente', 'Cirurgia recente (últimos 6 meses)?', 'Para evitar áreas sensíveis ou em cicatrização'),
];
const alergia = (rotulo: string, ajuda: string): CampoNovo[] => [
  simNao('alergia', rotulo, ajuda),
  texto('alergia_detalhe', 'Descreva as alergias conhecidas', 'Opcional'),
];

/** Modelo de formulário por segmento (Empresa & Segmento). O do spa é a ficha que o totem sempre teve. */
export const PRESETS: Record<string, CampoNovo[]> = {
  spa_bemestar: [
    ...SAUDE,
    ...alergia('Alergia a cosméticos ou óleos?', 'Usaremos produtos hipoalergênicos neutros'),
    escolha('pressao_massagem', 'Pressão desejada na massagem', null, ['Suave', 'Média', 'Firme'], [], false),
    escolha('aromaterapia', 'Experiência aromática', null, ['Lavanda', 'Alecrim & Eucalipto', 'Bergamota & Capim-Limão', 'Sem aroma'], [], false),
    texto('areas_evitar', 'Partes do corpo a evitar ou áreas com maior tensão', 'Ex.: foco nos ombros; não massagear os pés'),
  ],
  clinica_saude: [
    ...SAUDE,
    ...alergia('Tem alguma alergia?', 'Medicamentos, látex ou produtos'),
    texto('medicamentos', 'Usa algum medicamento contínuo?', 'Opcional'),
    texto('observacoes', 'Alguma observação para o atendimento?', 'Opcional'),
  ],
  beleza_barbearia: [
    ...alergia('Tem alergia a algum produto?', 'Tinturas, químicas ou cosméticos'),
    simNao('quimica_recente', 'Fez química no cabelo nos últimos 30 dias?', 'Alisamento, coloração ou descoloração', false, false),
    texto('observacoes', 'Alguma preferência para o atendimento?', 'Opcional', false),
  ],
  estudio_fitness: [
    simNao('lesao_dor', 'Tem alguma lesão ou dor no momento?', 'Para adaptar os exercícios'),
    simNao('restricao_medica', 'Tem restrição médica para atividade física?', null),
    ...alergia('Tem alguma alergia?', 'Para a equipe se preparar'),
    texto('observacoes', 'Alguma observação para o atendimento?', 'Opcional'),
  ],
  geral: [
    ...alergia('Tem alguma alergia?', 'Para a equipe se preparar'),
    texto('observacoes', 'Alguma observação ou preferência para o atendimento?', 'Opcional'),
  ],
};
export const presetDoSegmento = (segmento: string | null | undefined) => PRESETS[segmento ?? ''] ?? PRESETS.geral;

// ---- Editor (PersonalizarFormularioModal): mesma regra na tela e nos testes ----
type CampoDoEditor = Pick<CampoFormulario, 'rotulo' | 'tipo' | 'opcoes' | 'respostasAlerta'>;
const comOpcoes = (tipo: TipoCampo) => tipo === 'escolha_unica' || tipo === 'multipla_escolha';

/** Troca o tipo mantendo rótulo e ajuda; opções só nos tipos de escolha e alertas só com opção que ainda existe. */
export const mudarTipoCampo = <T extends CampoDoEditor>(campo: T, tipo: TipoCampo): T => {
  const opcoes = comOpcoes(tipo) ? (campo.opcoes.some((o) => o.trim()) ? campo.opcoes : ['Opção 1', 'Opção 2']) : [];
  const validas = tipo === 'sim_nao' ? OPCOES_SIM_NAO : opcoes;
  return { ...campo, tipo, opcoes, respostasAlerta: tipo === 'texto_livre' ? [] : campo.respostasAlerta.filter((r) => validas.includes(r)) };
};

/**
 * Troca a lista de opções. Opção renomeada (mesma posição) leva junto a marcação de alerta; removida, perde.
 * Assim não sobra resposta de alerta órfã gravada no banco.
 */
export const editarOpcoes = <T extends CampoDoEditor>(campo: T, novas: string[]): T => {
  const respostasAlerta = campo.opcoes.flatMap((antiga, i) => {
    if (!campo.respostasAlerta.includes(antiga)) return [];
    if (novas.includes(antiga)) return [antiga];
    // Mesmo tamanho = renomeou a opção desta posição; outro tamanho = removeu (a marcação sai)
    return novas.length === campo.opcoes.length && novas[i]?.trim() ? [novas[i]] : [];
  });
  return { ...campo, opcoes: novas, respostasAlerta: [...new Set(respostasAlerta)] };
};

/** Problemas de um campo para mostrar no editor antes de salvar (a API valida de novo). */
export const errosDoCampo = (campo: CampoDoEditor): string[] => {
  const erros: string[] = [];
  if (!campo.rotulo.trim()) erros.push('Escreva a pergunta.');
  if (comOpcoes(campo.tipo)) {
    const preenchidas = campo.opcoes.map((o) => o.trim()).filter(Boolean);
    if (preenchidas.length < 2) erros.push('Preencha pelo menos 2 opções.');
    if (campo.opcoes.some((o) => !o.trim())) erros.push('Há uma opção em branco: escreva ou remova.');
    if (new Set(preenchidas.map((o) => o.toLowerCase())).size !== preenchidas.length) erros.push('Há opções repetidas.');
  }
  return erros;
};

/**
 * Ficha enviada junto com um cadastro ou agendamento: a recepção grava às cegas só as perguntas do totem/ambos
 * (canal 'recepcao'); o resto da equipe grava as da equipe. Sem resposta, null (não cria ficha vazia).
 */
export const fichaDoAto = (campos: CampoFormulario[], respostas: unknown, papel: string | undefined) => {
  if (!respostas || typeof respostas !== 'object' || Object.keys(respostas).length === 0) return null;
  const recepcao = papel === 'receptionist';
  const { itens, erro } = lerRespostas(campos, respostas, recepcao ? 'totem' : 'profissional');
  if (erro) return { erro };
  if (itens.length === 0) return null;
  return { itens, canal: recepcao ? 'recepcao' as const : 'profissional' as const, canalSnapshot: recepcao ? 'totem' as const : 'profissional' as const };
};
