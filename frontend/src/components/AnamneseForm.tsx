import React, { useState } from 'react';

export interface AnamneseData {
  profissao: string;
  queixa: string;
  proteses: string;
  cirurgia: string;
  gravida: string;
  caracteristicas: string[];
  medicamentos: string[];
  procedimentoEstetico: string;
  marcapasso: string;
  outrosMedicamentos: string;
  lentesContato: string;
  alergia: string;
  patologia: string;
  partesNaoTocadas: string;

  preferencia: string;
  pressao: string;
  banho: string;
  aromaterapia: string;
}

export const initialAnamnese: AnamneseData = {
  profissao: '', queixa: '', proteses: '', cirurgia: '', gravida: '',
  caracteristicas: [], medicamentos: [], procedimentoEstetico: '', marcapasso: '',
  outrosMedicamentos: '', lentesContato: '', alergia: '', patologia: '', partesNaoTocadas: '',
  preferencia: '', pressao: '', banho: '', aromaterapia: ''
};

export const formatAnamnese = (data: AnamneseData): string => {
  const parts = [];
  if (data.profissao) parts.push(`Profissão: ${data.profissao}`);
  if (data.queixa) parts.push(`Queixa: ${data.queixa}`);
  if (data.proteses) parts.push(`Próteses/Pinos: ${data.proteses}`);
  if (data.cirurgia) parts.push(`Cirurgia Recente: ${data.cirurgia}`);
  if (data.gravida) parts.push(`Grávida: ${data.gravida}`);
  if (data.caracteristicas.length > 0) parts.push(`Características: ${data.caracteristicas.join(', ')}`);
  if (data.medicamentos.length > 0) parts.push(`Medicamentos: ${data.medicamentos.join(', ')}`);
  if (data.procedimentoEstetico) parts.push(`Procedimento Estético (6m): ${data.procedimentoEstetico}`);
  if (data.marcapasso) parts.push(`Marcapasso: ${data.marcapasso}`);
  if (data.outrosMedicamentos) parts.push(`Outros Medicamentos: ${data.outrosMedicamentos}`);
  if (data.lentesContato) parts.push(`Lentes de Contato: ${data.lentesContato}`);
  if (data.alergia) parts.push(`Alergias: ${data.alergia}`);
  if (data.patologia) parts.push(`Patologias: ${data.patologia}`);
  if (data.partesNaoTocadas) parts.push(`Não Tocar: ${data.partesNaoTocadas}`);
  
  if (data.preferencia) parts.push(`Preferência de Tratamento: ${data.preferencia}`);
  if (data.pressao) parts.push(`Pressão da Massagem: ${data.pressao}`);
  if (data.banho) parts.push(`Banho: ${data.banho}`);
  if (data.aromaterapia) parts.push(`Aromaterapia (Profissional): ${data.aromaterapia}`);
  
  return parts.length > 0 ? `\n\n--- FICHA DE ANAMNESE ---\n${parts.join(' | ')}` : '';
};

interface Props {
  data: AnamneseData;
  onChange: (data: AnamneseData) => void;
  onClose: () => void;
}

export function AnamneseForm({ data, onChange, onClose }: Props) {
  const updateField = (field: keyof AnamneseData, value: AnamneseData[keyof AnamneseData]) => onChange({ ...data, [field]: value });

  const toggleYesNoField = (field: keyof AnamneseData, option: 'Sim' | 'Não') => {
    const currentValue = String(data[field] || '');
    updateField(field, (currentValue === option ? '' : option) as AnamneseData[keyof AnamneseData]);
  };

  const YesNoField = ({
    label,
    field,
  }: {
    label: string;
    field: keyof AnamneseData;
  }) => {
    const currentValue = String(data[field] || '');

    return (
      <div>
        <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">{label}</label>
        <div className="flex gap-3">
          {(['Sim', 'Não'] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 cursor-pointer text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={currentValue === option}
                onChange={() => toggleYesNoField(field, option)}
                className="rounded border-outline-variant/40 text-primary focus:ring-primary cursor-pointer w-4 h-4 transition-all"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  const toggleArrayItem = (field: 'caracteristicas' | 'medicamentos', item: string) => {
    const arr = data[field];
    if (arr.includes(item)) {
      updateField(field, arr.filter(i => i !== item));
    } else {
      updateField(field, [...arr, item]);
    }
  };

  const CARACTERISTICAS_LIST = [
    'Cansaço', 'Depressão', 'Claustrofobia', 'Dores Musculares', 'Alergias', 'Reumatismo', 'Problemas de Coração',
    'Artrites', 'Dores de cabeça', 'Epilepsia', 'Eczemas', 'Ansiedade', 'Hipertireoidismo', 'Hipotireoidismo',
    'Herpes', 'Vertigem', 'Psoríases', 'Furúnculo', 'Asma', 'Diabetes', 'Hipotensão', 'Hepatite', 'Câncer',
    'Hemofilia', 'Osteoporose', 'Problemas Articulares', 'Problemas Respiratório'
  ];

  const MEDICAMENTOS_LIST = [
    'Retin-A', 'Insulina', 'Hormônios', 'Anticoncepcional', 'Controle de pressão', 'Botox', 'Ácido', 'Preenchimento'
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-70 flex justify-center items-start overflow-y-auto p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-surface-container-lowest w-full max-w-4xl rounded-3xl shadow-2xl border border-outline-variant/30 flex flex-col my-auto relative overflow-hidden">
        {/* Header Fixo */}
        <div className="bg-surface-container sticky top-0 z-10 p-6 flex justify-between items-center border-b border-outline-variant/20 shadow-sm">
          <div>
            <h2 className="text-xl font-headline text-primary">Ficha de Anamnese</h2>
            <p className="text-xs text-on-surface-variant uppercase tracking-widest mt-1">Preencha com o cliente</p>
          </div>
          <button onClick={onClose} type="button" className="p-2 hover:bg-surface-container-highest rounded-full text-on-surface-variant transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-8 overflow-y-auto max-h-[75vh] custom-scrollbar">
          
          {/* Termos e Avisos Obrigatórios */}
          <div className="bg-error-container/20 border border-error/30 p-5 rounded-2xl space-y-3">
            <p className="text-sm font-bold text-error uppercase tracking-widest flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">warning</span> Avisos Obrigatórios
            </p>
            <p className="text-sm text-on-surface leading-relaxed"><strong>Conduta e Ética Profissional:</strong> Todos os atendimentos prestados em nosso estabelecimento seguem rigorosos padrões éticos e profissionais. A relação entre cliente e profissional é estritamente de respeito mútuo. Qualquer comportamento inadequado resultará no encerramento imediato do atendimento.</p>
          </div>

          <h3 className="text-lg font-headline text-secondary border-b border-outline-variant/20 pb-2">Ficha de Perfil</h3>

          {/* Dados Textuais Basicos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Profissão</label>
              <input type="text" value={data.profissao} onChange={e => updateField('profissao', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Alguma queixa principal?</label>
              <input type="text" value={data.queixa} onChange={e => updateField('queixa', e.target.value)} placeholder="Ex: dores nas costas, muscular..." className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Faz uso de próteses, pinos ou placas metálicas? Qual?</label>
              <input type="text" value={data.proteses} onChange={e => updateField('proteses', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Realizou alguma cirurgia recentemente?</label>
              <input type="text" value={data.cirurgia} onChange={e => updateField('cirurgia', e.target.value)} placeholder="Se sim, há quanto tempo e em qual lugar?" className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <YesNoField label="Está grávida?" field="gravida" />
            <YesNoField label="Faz uso de Marcapasso?" field="marcapasso" />
          </div>

          <div className="pt-4">
            <label className="block text-sm font-bold text-on-surface uppercase mb-3 border-b border-outline-variant/20 pb-2">Apresenta alguma das características abaixo:</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CARACTERISTICAS_LIST.map(c => (
                <label key={c} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={data.caracteristicas.includes(c)} onChange={() => toggleArrayItem('caracteristicas', c)} className="rounded border-outline-variant/40 text-primary focus:ring-primary cursor-pointer w-4 h-4 transition-all" />
                  <span className="text-[11px] font-medium text-on-surface-variant group-hover:text-primary transition-colors">{c}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4">
            <label className="block text-sm font-bold text-on-surface uppercase mb-3 border-b border-outline-variant/20 pb-2">Medicamentos utilizados nos últimos 3 meses:</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {MEDICAMENTOS_LIST.map(m => (
                <label key={m} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={data.medicamentos.includes(m)} onChange={() => toggleArrayItem('medicamentos', m)} className="rounded border-outline-variant/40 text-primary focus:ring-primary cursor-pointer w-4 h-4 transition-all" />
                  <span className="text-[11px] font-medium text-on-surface-variant group-hover:text-primary transition-colors">{m}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Realizou procedimento estético nos últimos 6 meses?</label>
              <div className="flex gap-3">
                {(['Sim', 'Não'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={data.procedimentoEstetico === opt}
                      onChange={() => toggleYesNoField('procedimentoEstetico', opt)}
                      className="rounded border-outline-variant/40 text-primary focus:ring-primary cursor-pointer w-4 h-4 transition-all"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Toma algum medicamento além dos citados?</label>
              <input type="text" value={data.outrosMedicamentos} onChange={e => updateField('outrosMedicamentos', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <YesNoField label="Faz uso de lentes de contato?" field="lentesContato" />
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Tem alguma alergia?</label>
              <input type="text" value={data.alergia} onChange={e => updateField('alergia', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Alguma patologia?</label>
              <input type="text" value={data.patologia} onChange={e => updateField('patologia', e.target.value)} placeholder="Ex: Câncer, Trombose, Fibromialgia..." className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Partes que NÃO gostaria que fossem tocadas?</label>
              <input type="text" value={data.partesNaoTocadas} onChange={e => updateField('partesNaoTocadas', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
            </div>
          </div>

          <h3 className="text-lg font-headline text-secondary border-b border-outline-variant/20 pb-2 pt-6">Preferências do Tratamento</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
            <div>
              <label className="block text-sm font-bold text-on-surface-variant uppercase mb-3">Preferência (veículo)</label>
              <div className="flex gap-6">
                {['Óleo', 'Creme'].map(p => <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="preferencia" checked={data.preferencia === p} onChange={() => updateField('preferencia', p)} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> {p}</label>)}
              </div>

              <label className="block text-sm font-bold text-on-surface-variant uppercase mb-3 mt-8">Banhos (Alternativos e Relaxantes)</label>
              <p className="text-[10px] text-on-surface-variant mb-2">Faça a escolha do seu Óleo de banho:</p>
              <div className="flex flex-col gap-3">
                {['Óleo Energizante', 'Óleo Relaxante', 'Óleo Equilíbrio'].map(b => <label key={b} className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="banho" checked={data.banho === b} onChange={() => updateField('banho', b)} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> {b}</label>)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-on-surface-variant uppercase mb-3">Pressão da Massagem</label>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="pressao" checked={data.pressao === 'Nível 1'} onChange={() => updateField('pressao', 'Nível 1')} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> Nível 1 - Pressão Leve</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="pressao" checked={data.pressao === 'Nível 2'} onChange={() => updateField('pressao', 'Nível 2')} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> Nível 2 - Moderada, sem nódulos</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="pressao" checked={data.pressao === 'Nível 3'} onChange={() => updateField('pressao', 'Nível 3')} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> Nível 3 - Moderada/Intensa, com nódulos</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="pressao" checked={data.pressao === 'Nível 4'} onChange={() => updateField('pressao', 'Nível 4')} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> Nível 4 - Intensa, com nódulos</label>
              </div>

              <div className="mt-8 bg-primary/5 p-4 rounded-2xl border border-primary/20">
                <label className="block text-sm font-bold text-primary uppercase mb-2">Campo do Profissional (Aromaterapia)</label>
                <div className="flex flex-col gap-2">
                  {['Blend Zen', 'Blend Refrescante', 'Blend Energizante'].map(a => <label key={a} className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="aroma" checked={data.aromaterapia === a} onChange={() => updateField('aromaterapia', a)} className="text-primary focus:ring-primary bg-surface-container-lowest border-outline-variant/30 w-4 h-4" /> <span className="text-on-surface">{a}</span></label>)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-surface-container-low p-6 border-t border-outline-variant/20 flex justify-end gap-4 mt-auto">
          <button type="button" onClick={onClose} className="px-6 py-3 font-bold uppercase tracking-widest text-xs bg-primary text-on-primary rounded-xl shadow hover:bg-primary-dim transition-all">
            Concluir Anamnese / Retornar
          </button>
        </div>
      </div>
    </div>
  );
}