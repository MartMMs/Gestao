import { useMemo } from 'react';
import { horarioParaMinutos, lerFuncionamento, type Funcionamento } from '@shared/agenda';
import { useCompanyConfig } from '../api';

// Horário de funcionamento da empresa (o padrão enquanto a config carrega). Mesmas regras do backend.
// Mesmo objeto enquanto a config não muda: entra em dependências de useMemo/useCallback
export const useFuncionamento = (): Funcionamento => {
  const { data } = useCompanyConfig();
  return useMemo(() => lerFuncionamento(data), [data]);
};

// Horas cheias que a grade da agenda mostra: da abertura ao fechamento (arredondado para cima), estendida para caber
// atendimentos marcados fora do horário (marcados antes de ele mudar): sem isso eles sumiriam da grade
export const horasDaGrade = (f: Funcionamento, atendimentos: Array<[inicioMin: number, fimMin: number]> = []) => ({
  horaInicioGrade: Math.floor(Math.min(horarioParaMinutos(f.abertura), ...atendimentos.map(([i]) => i)) / 60),
  horaFimGrade: Math.min(24, Math.ceil(Math.max(horarioParaMinutos(f.fechamento), ...atendimentos.map(([, fim]) => fim)) / 60)),
});
