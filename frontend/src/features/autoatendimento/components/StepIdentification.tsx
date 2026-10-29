import React, { useEffect, useState } from 'react';
import { AutoatendimentoReservaSession } from '../../../types';
import { formatPhone, formatCpf } from '../../../utils/formatters';
import { cpfValido, telefoneValido } from '@shared/validadores';

interface StepIdentificationProps {
  reservation: AutoatendimentoReservaSession;
  onSubmit: (data: {
    nome: string;
    telefone: string;
    cpf: string;
    observacoesSaude: string;
  }) => void;
  onBack: () => void;
}

// Rascunho em memória do atendimento atual: voltar para trocar horário ou sair do pagamento não apaga
// o que foi digitado. Fica só na memória da aba (nada de localStorage num totem público com dados de saúde)
// e é limpo ao concluir ou recomeçar o atendimento.
type Rascunho = {
  nome: string; telefone: string; cpf: string; gestante: boolean | null; pressao: 'normal' | 'alta' | 'baixa';
  cirurgiaRecente: boolean | null; alergia: boolean | null; detalheAlergia: string;
  pressaoMassagem: 'suave' | 'media' | 'firme'; aroma: string; areasEvitar: string;
};
let rascunho: Rascunho | null = null;

export const limparRascunhoIdentificacao = () => {
  rascunho = null;
};

export function StepIdentification({ reservation, onSubmit, onBack }: StepIdentificationProps) {
  const salvo = rascunho;
  const [nome, setNome] = useState(salvo?.nome ?? '');
  const [telefone, setTelefone] = useState(salvo?.telefone ?? '');
  const [cpf, setCpf] = useState(salvo?.cpf ?? '');

  // Anamnese Dinâmica
  const [gestante, setGestante] = useState<boolean | null>(salvo?.gestante ?? null);
  const [pressao, setPressao] = useState<'normal' | 'alta' | 'baixa'>(salvo?.pressao ?? 'normal');
  const [cirurgiaRecente, setCirurgiaRecente] = useState<boolean | null>(salvo?.cirurgiaRecente ?? null);
  const [alergia, setAlergia] = useState<boolean | null>(salvo?.alergia ?? null);
  const [detalheAlergia, setDetalheAlergia] = useState(salvo?.detalheAlergia ?? '');
  const [pressaoMassagem, setPressaoMassagem] = useState<'suave' | 'media' | 'firme'>(salvo?.pressaoMassagem ?? 'media');
  const [aroma, setAroma] = useState<string>(salvo?.aroma ?? 'lavanda');
  const [areasEvitar, setAreasEvitar] = useState<string>(salvo?.areasEvitar ?? '');

  useEffect(() => {
    rascunho = { nome, telefone, cpf, gestante, pressao, cirurgiaRecente, alergia, detalheAlergia, pressaoMassagem, aroma, areasEvitar };
  }, [nome, telefone, cpf, gestante, pressao, cirurgiaRecente, alergia, detalheAlergia, pressaoMassagem, aroma, areasEvitar]);

  const [erros, setErros] = useState<{ nome?: string; telefone?: string; cpf?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErros: { nome?: string; telefone?: string; cpf?: string } = {};

    if (!nome.trim() || nome.trim().length < 3) {
      newErros.nome = 'Por favor, informe seu nome completo.';
    }

    if (!/^[\p{L}][\p{L} .'-]*$/u.test(nome.trim())) {
      newErros.nome = 'O nome deve conter apenas letras.';
    }

    if (!telefoneValido(telefone)) {
      newErros.telefone = 'Informe um celular ou telefone com DDD válido, ex.: (11) 98765-4321.';
    }

    if (cpf.trim() && !cpfValido(cpf)) {
      newErros.cpf = 'CPF inválido. Confira os dígitos ou deixe o campo em branco.';
    }

    if (Object.keys(newErros).length > 0) {
      setErros(newErros);
      return;
    }

    // Monta o resumo da Anamnese para a equipe do Spa
    const healthSummaryParts: string[] = [];
    if (gestante) healthSummaryParts.push('GESTANTE: Sim');
    if (pressao !== 'normal') healthSummaryParts.push(`Pressão: ${pressao}`);
    if (cirurgiaRecente) healthSummaryParts.push('Cirurgia/Procedimento recente: Sim');
    if (alergia) healthSummaryParts.push(`Alergia: ${detalheAlergia || 'Sim'}`);
    healthSummaryParts.push(`Pressão massagem: ${pressaoMassagem}`);
    healthSummaryParts.push(`Aroma preferido: ${aroma}`);
    if (areasEvitar.trim()) healthSummaryParts.push(`Áreas a evitar: ${areasEvitar.trim()}`);

    onSubmit({
      nome: nome.trim(),
      telefone,
      cpf,
      observacoesSaude: healthSummaryParts.join(' | '),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
          Etapa 3 de 4 · Identificação e Saúde
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          Ficha Personalizada do Spa
        </h2>
        <p className="text-sm text-on-surface-variant font-body">
          Suas informações garantem um atendimento sob medida, seguro e terapêutico para seu bem-estar.
        </p>
      </div>

      {/* Mini resumo da reserva com cadeado */}
      <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">lock</span>
          <span className="text-on-surface">
            Horário pré-reservado: <strong>{reservation.data} às {reservation.horario}</strong> ({reservation.servicoNome})
          </span>
        </div>
        <span className="text-[11px] text-primary font-bold">
          {reservation.salaNome} · {reservation.terapeutaNome}
        </span>
      </div>

      {/* Dados de Contato */}
      <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">person</span>
          Dados Pessoais
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">
              Nome Completo *
            </label>
            <input
              type="text"
              required
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (erros.nome) setErros((prev) => ({ ...prev, nome: undefined }));
              }}
              placeholder="Ex: Mariana Albuquerque"
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm text-on-surface"
            />
            {erros.nome && <p className="text-xs text-error mt-1">{erros.nome}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">
              WhatsApp / Celular *
            </label>
            <input
              type="tel"
              required
              value={telefone}
              onChange={(e) => {
                setTelefone(formatPhone(e.target.value));
                if (erros.telefone) setErros((prev) => ({ ...prev, telefone: undefined }));
              }}
              maxLength={15}
              placeholder="(11) 98765-4321"
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm text-on-surface"
            />
            {erros.telefone && <p className="text-xs text-error mt-1">{erros.telefone}</p>}
            <p className="text-[10px] text-outline-variant mt-1">
              Enviaremos seu voucher e lembretes por este número.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">
              CPF (Opcional para recibo)
            </label>
            <input
              type="text"
              value={cpf}
              onChange={(e) => {
                setCpf(formatCpf(e.target.value));
                if (erros.cpf) setErros((prev) => ({ ...prev, cpf: undefined }));
              }}
              maxLength={14}
              placeholder="000.000.000-00"
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm text-on-surface"
            />
            {erros.cpf && <p className="text-xs text-error mt-1">{erros.cpf}</p>}
          </div>
        </div>
      </div>

      {/* Formulário Dinâmico de Saúde & Cuidados */}
      <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">health_and_safety</span>
            Anamnese Rápida & Preferências
          </h3>
          <span className="text-[11px] text-outline-variant">Importante para sua segurança</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gestante */}
          <div className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-on-surface">Está gestante?</p>
              <p className="text-[10px] text-on-surface-variant">Requer cuidados de postura e óleos seguros</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGestante(false)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  gestante === false ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Não
              </button>
              <button
                type="button"
                onClick={() => setGestante(true)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  gestante === true ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Sim
              </button>
            </div>
          </div>

          {/* Pressão Arterial */}
          <div className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-on-surface">Pressão Arterial</p>
              <p className="text-[10px] text-on-surface-variant">Para ajuste térmico e intensidade</p>
            </div>
            <div className="flex gap-1.5">
              {(['normal', 'alta', 'baixa'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPressao(p)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-colors ${
                    pressao === p ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Cirurgias Recentes */}
          <div className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-on-surface">Cirurgia Recente (últimos 6 meses)?</p>
              <p className="text-[10px] text-on-surface-variant">Para evitar áreas sensíveis ou em cicatrização</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCirurgiaRecente(false)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  cirurgiaRecente === false ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Não
              </button>
              <button
                type="button"
                onClick={() => setCirurgiaRecente(true)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  cirurgiaRecente === true ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Sim
              </button>
            </div>
          </div>

          {/* Alergias */}
          <div className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-on-surface">Alergia a cosméticos ou óleos?</p>
              <p className="text-[10px] text-on-surface-variant">Usaremos produtos hipoalergênicos neutros</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAlergia(false);
                  setDetalheAlergia('');
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  alergia === false ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Não
              </button>
              <button
                type="button"
                onClick={() => setAlergia(true)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  alergia === true ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Sim
              </button>
            </div>
          </div>
        </div>

        {alergia && (
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1">
              Descreva as alergias conhecidas:
            </label>
            <input
              type="text"
              value={detalheAlergia}
              onChange={(e) => setDetalheAlergia(e.target.value)}
              placeholder="Ex: Alergia a canela, lavanda, amêndoas..."
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 text-xs text-on-surface"
            />
          </div>
        )}

        {/* Preferências de Massagem e Aroma */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">
              Pressão Desejada na Massagem
            </label>
            <div className="flex gap-2">
              {([
                { id: 'suave', label: 'Suave' },
                { id: 'media', label: 'Média' },
                { id: 'firme', label: 'Firme' },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPressaoMassagem(item.id)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    pressaoMassagem === item.id
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'bg-surface-container-low border border-outline-variant/20 text-on-surface-variant'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">
              Experiência Aromática
            </label>
            <select
              value={aroma}
              onChange={(e) => setAroma(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 text-xs text-on-surface"
            >
              <option value="lavanda">Lavanda Francesa (Relaxamento Profundo)</option>
              <option value="alecrim">Alecrim & Eucalipto (Descongestionante & Foco)</option>
              <option value="bergamota">Bergamota & Capim-Limão (Revigorante)</option>
              <option value="sem_aroma">Sem Aroma (Neutro Hipoalergênico)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface-variant mb-1">
            Partes do corpo a evitar ou áreas com maior tensão:
          </label>
          <input
            type="text"
            value={areasEvitar}
            onChange={(e) => setAreasEvitar(e.target.value)}
            placeholder="Ex: Foco nos ombros e pescoço; não massagear pés..."
            className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 text-xs text-on-surface"
          />
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="pt-4 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Alterar Horário</span>
        </button>

        <button
          type="submit"
          className="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-[0.15em] bg-primary text-on-primary hover:bg-primary-dim transition-all shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <span>{reservation.exigirPagamento === false ? 'Revisar e Confirmar' : 'Ir para Pagamento'}</span>
          <span className="material-symbols-outlined text-[18px]">{reservation.exigirPagamento === false ? 'task_alt' : 'payment'}</span>
        </button>
      </div>
    </form>
  );
}
