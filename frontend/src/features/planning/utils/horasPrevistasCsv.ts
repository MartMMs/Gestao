// CSV de "Horas Previstas" para o Excel em pt-BR: UTF-8 com BOM, separador ";" e vírgula decimal

export type LinhaHorasPrevistas = { nome: string; cargo?: string; dias: number; semTurno: number; normais: number; extras: number; total: number };

const celula = (valor: string | number) => {
  const texto = typeof valor === 'number' ? String(Math.round(valor * 100) / 100).replace('.', ',') : valor;
  // Aspas em tudo que pode quebrar a coluna; "=+-@" no início viraria fórmula no Excel
  const seguro = /^[=+\-@]/.test(texto) && typeof valor === 'string' ? `'${texto}` : texto;
  return /[";\n\r]/.test(seguro) || seguro !== texto ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

export function csvHorasPrevistas(linhas: LinhaHorasPrevistas[], mesLabel: string): string {
  const cabecalho = ['Colaborador', 'Cargo', 'Mês', 'Dias trabalhados', 'Dias sem turno', 'Horas normais', 'Horas extras', 'Total'];
  const corpo = linhas.map((l) => [l.nome, l.cargo || '', mesLabel, l.dias, l.semTurno, l.normais, l.extras, l.total]);
  const soma = (campo: 'dias' | 'semTurno' | 'normais' | 'extras' | 'total') => linhas.reduce((s, l) => s + l[campo], 0);
  const total = ['Total', '', mesLabel, soma('dias'), soma('semTurno'), soma('normais'), soma('extras'), soma('total')];
  return '﻿' + [cabecalho, ...corpo, total].map((linha) => linha.map(celula).join(';')).join('\r\n') + '\r\n';
}

export function baixarCsv(conteudo: string, nomeArquivo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
