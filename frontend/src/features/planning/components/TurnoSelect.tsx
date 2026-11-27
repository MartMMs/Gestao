import React from 'react';
import { useAuth } from '../../../AuthContext';
import { useTurnos } from '../../../api';

interface TurnoSelectProps {
  value: string; // "HH:MM-HH:MM", como a escala grava
  onChange: (turno: string) => void;
  className?: string;
  id?: string;
  /** Com valor vazio, a primeira opção é esta (ex.: dia sem turno); sem ela, vazio não é oferecido */
  rotuloVazio?: string;
}

// Opções vêm dos turnos padrão (Regras e Turnos). Um horário que não está mais na lista (turno excluído) continua
// aparecendo para não trocar o dia de ninguém sem querer.
export function TurnoSelect({ value, onChange, className, id, rotuloVazio }: TurnoSelectProps) {
  const { token } = useAuth();
  const { data: turnos = [] } = useTurnos(token);
  const opcoes = turnos.map((t) => ({ valor: `${t.inicio}-${t.fim}`, rotulo: `${t.nome} (${t.inicio} - ${t.fim})` }));
  if (value && !opcoes.some((o) => o.valor === value)) opcoes.unshift({ valor: value, rotulo: value.replace('-', ' - ') });
  if (rotuloVazio) opcoes.unshift({ valor: '', rotulo: rotuloVazio });

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
    </select>
  );
}
