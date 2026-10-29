// Validações de documentos e contatos compartilhadas entre backend e frontend.

export const apenasDigitos = (valor: unknown) => String(valor ?? '').replace(/\D/g, '');

// Valida CPF pelos dígitos verificadores
export const cpfValido = (cpf: unknown): boolean => {
  // Aceita só dígitos com a pontuação usual (rejeita letras misturadas)
  if (typeof cpf !== 'string' && typeof cpf !== 'number') return false;
  if (!/^[\d.\-\s]+$/.test(String(cpf))) return false;
  const digitos = apenasDigitos(cpf);
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  const calcularDigito = (base: string, pesoInicial: number) => {
    const soma = base.split('').reduce((total, d, i) => total + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = calcularDigito(digitos.slice(0, 9), 10);
  const d2 = calcularDigito(digitos.slice(0, 10), 11);
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
};

// Remove o DDI 55 quando presente e devolve DDD + número
export const normalizarTelefone = (telefone: unknown): string => {
  let digitos = apenasDigitos(telefone);
  // Remove o DDI só quando sobra um número completo (12 dígitos = 55 + fixo, 13 = 55 + celular)
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
  return digitos;
};

// DDDs em uso no Brasil (Anatel). Combinações como 23, 25, 29 ou 52 não existem.
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// Telefone brasileiro: DDD existente + 8 dígitos (fixo) ou 9 dígitos começando com 9 (celular)
export const telefoneValido = (telefone: unknown): boolean => {
  const digitos = normalizarTelefone(telefone);
  if (!DDDS_VALIDOS.has(Number(digitos.slice(0, 2)))) return false;
  // Fixo: 8 dígitos começando de 2 a 5. Celular: 9 dígitos começando com 9.
  return (digitos.length === 10 && /[2-5]/.test(digitos[2])) || (digitos.length === 11 && digitos[2] === '9');
};

// Mensagens únicas para a agenda interna e o totem
export const MENSAGEM_TELEFONE_INVALIDO = 'Telefone inválido. Informe DDD + número, ex.: (11) 98765-4321.';
export const MENSAGEM_CPF_INVALIDO = 'CPF inválido. Confira os dígitos.';

// Valores mascarados pela API (ex.: "(11) *****-**21") nunca devem ser gravados de volta
export const valorMascarado = (valor: unknown) => typeof valor === 'string' && valor.includes('*');

export const normalizarNome = (nome: unknown) => String(nome ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Limite comum para observações/anamnese (agenda interna, clientes e totem)
export const LIMITE_OBSERVACAO = 5000;

// Formatos em que um mesmo telefone pode estar gravado (cadastros antigos guardavam com máscara)
export const variantesTelefone = (telefone: unknown): string[] => {
  const d = normalizarTelefone(telefone);
  if (!d) return [];
  const formatado = d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return Array.from(new Set([d, formatado, `55${d}`]));
};

export const variantesCpf = (cpf: unknown): string[] => {
  const d = apenasDigitos(cpf);
  if (d.length !== 11) return [d];
  return [d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`];
};
