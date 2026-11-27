import { formatarDataComDiaSemanaBR } from '@shared/datasBR';
import React, { useEffect, useState } from 'react';
import { AutoatendimentoReservaSession } from '../../../types';
import { formatPhone, formatCpf } from '../../../utils/formatters';
import { cpfValido, telefoneValido } from '@shared/validadores';
import { perguntasDoSegmento } from '@shared/segmento';
import { obrigatoriaPendente, type CampoPublico, type ValorResposta } from '@shared/formularioAnamnese';
import { CamposDinamicos } from '../../../components/CamposDinamicos';
import { textoConsentimento } from '@shared/consentimento';
import { LinksDocumentosLegais } from '../../../components/DocumentosLegais';
import { fetchFormularioTotem, type DadosClienteTotem } from '../services/autoatendimentoService';

// "2026-11-21" -> "sáb, 21/11" (meio-dia UTC: o dia não muda com o fuso)
export const dataHumana = (data: string) => formatarDataComDiaSemanaBR(data);

interface StepIdentificationProps {
  reservation: AutoatendimentoReservaSession;
  // Nome da empresa no texto do consentimento (quem trata os dados)
  nomeEmpresa?: string;
  // Segmento da empresa: decide quais perguntas aparecem (as de saúde e as de spa não servem para todo negócio)
  segmento?: string;
  // A API tem provedor de WhatsApp: só então prometemos voucher e lembretes por mensagem
  whatsappAtivo?: boolean;
  onSubmit: (data: DadosClienteTotem) => void;
  onBack: () => void;
}

// Rascunho em memória do atendimento atual: voltar para trocar horário ou sair do pagamento não apaga
// o que foi digitado. Fica só na memória da aba (nada de localStorage num totem público com dados de saúde)
// e é limpo ao concluir ou recomeçar o atendimento.
type Rascunho = {
  nome: string; telefone: string; cpf: string; respostas: Record<string, ValorResposta>; consentimento: boolean;
};
let rascunho: Rascunho | null = null;

export const limparRascunhoIdentificacao = () => {
  rascunho = null;
};

export function StepIdentification({ reservation, nomeEmpresa, segmento, whatsappAtivo, onSubmit, onBack }: StepIdentificationProps) {
  const { saude } = perguntasDoSegmento(segmento);
  
  const salvo = rascunho;
  const [nome, setNome] = useState(salvo?.nome ?? '');
  const [telefone, setTelefone] = useState(salvo?.telefone ?? '');
  const [cpf, setCpf] = useState(salvo?.cpf ?? '');

  // Perguntas do formulário configurável (Empresa & Segmento > Personalizar formulário). null = carregando;
  // se a busca falhar, o cliente segue sem as perguntas (a recepção completa a ficha no check-in)
  const [campos, setCampos] = useState<CampoPublico[] | null>(null);
  const [falhaFormulario, setFalhaFormulario] = useState(false);
  useEffect(() => {
    let ativo = true;
    fetchFormularioTotem()
      .then((f) => { if (ativo) setCampos(f.campos); })
      .catch(() => { if (ativo) { setCampos([]); setFalhaFormulario(true); } });
    return () => { ativo = false; };
  }, []);
  // A autorização (LGPD) é sempre pedida: nome e telefone já são dados pessoais. O texto segue o segmento, como antes
  const termo = textoConsentimento(nomeEmpresa, saude);
  const [respostas, setRespostas] = useState<Record<string, ValorResposta>>(salvo?.respostas ?? {});
  const [consentimento, setConsentimento] = useState<boolean>(salvo?.consentimento ?? false);

  useEffect(() => {
    rascunho = { nome, telefone, cpf, respostas, consentimento };
  }, [nome, telefone, cpf, respostas, consentimento]);

  const [erros, setErros] = useState<{ nome?: string; telefone?: string; cpf?: string; consentimento?: string; ficha?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErros: { nome?: string; telefone?: string; cpf?: string; consentimento?: string; ficha?: string } = {};

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

    // Só os campos que estão na tela (o rascunho pode ter respostas de um formulário que mudou)
    const visiveis = campos ?? [];
    const pendente = obrigatoriaPendente(visiveis, respostas);
    if (pendente) newErros.ficha = `Responda: ${pendente.rotulo}`;

    if (!consentimento) {
      newErros.consentimento = 'Para continuar, marque a autorização de uso dos seus dados.';
    }

    if (Object.keys(newErros).length > 0) {
      setErros(newErros);
      return;
    }

    onSubmit({
      nome: nome.trim(),
      telefone,
      cpf,
      // A API monta o resumo de texto a partir das respostas (e grava a ficha com as perguntas desta versão)
      observacoesSaude: '',
      ...(campos && !falhaFormulario ? { respostas: Object.fromEntries(visiveis.map((c) => [c.id, respostas[c.id]]).filter(([, v]) => v !== undefined)) } : {}),
      consentimento: true,
      // A versão do mesmo texto que está na tela
      consentimentoVersao: termo.versao,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-xs font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
          Etapa 3 de 4 · {saude ? 'Identificação e Saúde' : 'Identificação'}
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          Seus dados para o atendimento
        </h2>
        <p className="text-sm text-on-surface-variant font-body">
          Essas informações ajudam a equipe a preparar o seu atendimento com segurança.
        </p>
      </div>

      {/* Mini resumo da reserva com cadeado */}
      <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">lock</span>
          <span className="text-on-surface">
            Horário pré-reservado: <strong>{dataHumana(reservation.data)} às {reservation.horario}</strong> ({reservation.servicoNome})
          </span>
        </div>
        <span className="text-xs text-primary font-bold">
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
            <label htmlFor="totem-nome" className="block text-xs font-bold text-on-surface-variant mb-1.5">
              Nome Completo *
            </label>
            <input
              id="totem-nome"
              type="text"
              required
              autoComplete="name"
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
            <label htmlFor="totem-telefone" className="block text-xs font-bold text-on-surface-variant mb-1.5">
              WhatsApp / Celular *
            </label>
            <input
              id="totem-telefone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
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
            <p className="text-xs text-on-surface-variant mt-1">
              {whatsappAtivo
                ? 'Enviaremos seu voucher e lembretes por este número.'
                : 'Usado apenas para contato da recepção sobre o seu agendamento.'}
            </p>
          </div>

          <div>
            <label htmlFor="totem-cpf" className="block text-xs font-bold text-on-surface-variant mb-1.5">
              CPF (Opcional para recibo)
            </label>
            <input
              id="totem-cpf"
              type="text"
              inputMode="numeric"
              autoComplete="off"
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

      {/* Formulário de anamnese configurável (campos "ambos" e "apenas_totem") */}
      {(campos === null || campos.length > 0) && (
      <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">health_and_safety</span>
            {saude ? 'Saúde e cuidados' : 'Informações para o atendimento'}
          </h3>
          <span className="text-xs text-on-surface-variant">Importante para sua segurança</span>
        </div>
        {campos === null ? (
          <p className="text-xs text-on-surface-variant" role="status">Carregando perguntas...</p>
        ) : (
          <CamposDinamicos
            idBase="totem-campo"
            campos={campos}
            valores={respostas}
            onChange={(id, valor) => { setRespostas((atual) => ({ ...atual, [id]: valor })); setErros((e) => ({ ...e, ficha: undefined })); }}
          />
        )}
        {erros.ficha && <p role="alert" className="text-xs font-bold text-error">{erros.ficha}</p>}
      </div>
      )}

      {/* Consentimento LGPD (dados de saúde exigem autorização específica, art. 11) */}
      <div className={`rounded-xl border p-4 ${erros.consentimento ? 'border-error bg-error/5' : 'border-outline-variant/30 bg-surface-container-low'}`}>
        <label className="flex items-center gap-3 min-h-11 text-sm text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => {
              setConsentimento(e.target.checked);
              if (e.target.checked) setErros((atual) => ({ ...atual, consentimento: undefined }));
            }}
            className="h-6 w-6 shrink-0 accent-primary"
            aria-describedby="consentimento-detalhe"
            aria-invalid={Boolean(erros.consentimento)}
          />
          <span>{termo.autorizacao}</span>
        </label>
        <p id="consentimento-detalhe" className="mt-2 pl-8 text-xs text-on-surface-variant">
          {termo.detalhe}
        </p>
        {/* Fora da descrição do checkbox (o leitor de tela não lê o link como parte dela). Os Termos de Uso são da equipe */}
        <p className="mt-1 pl-8 text-xs text-on-surface-variant"><LinksDocumentosLegais documentos={['privacidade']} /></p>
        {erros.consentimento && <p role="alert" className="mt-2 pl-8 text-xs font-bold text-error">{erros.consentimento}</p>}
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
