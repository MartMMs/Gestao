import { opcoesDoCampo, type CampoPublico, type ValorResposta } from '@shared/formularioAnamnese';

type Props = {
  campos: CampoPublico[];
  valores: Record<string, ValorResposta>;
  onChange: (campoId: string, valor: ValorResposta) => void;
  // Prefixo dos ids (o totem e a ficha da equipe podem estar na mesma página nos testes)
  idBase: string;
  desabilitado?: boolean;
};

const botao = (ativo: boolean) => `flex-1 min-w-[4.5rem] min-h-11 px-2 rounded-lg text-xs font-bold transition-colors ${
  ativo ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
}`;

/** Perguntas do formulário de anamnese configurável: totem (toque) e ficha da equipe usam o mesmo desenho. */
export function CamposDinamicos({ campos, valores, onChange, idBase, desabilitado = false }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {campos.map((campo) => {
        const id = `${idBase}-${campo.id}`;
        const valor = valores[campo.id];
        const titulo = `${campo.rotulo}${campo.obrigatorio ? ' *' : ''}`;
        if (campo.tipo === 'texto_livre') {
          return (
            <div key={campo.id} className="md:col-span-2">
              <label htmlFor={id} className="block text-xs font-bold text-on-surface mb-1">{titulo}</label>
              {campo.ajuda && <p id={`${id}-ajuda`} className="text-xs text-on-surface-variant mb-1">{campo.ajuda}</p>}
              <input
                id={id} type="text" maxLength={500} disabled={desabilitado} required={campo.obrigatorio}
                aria-describedby={campo.ajuda ? `${id}-ajuda` : undefined}
                value={typeof valor === 'string' ? valor : ''}
                onChange={(e) => onChange(campo.id, e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 min-h-11 text-sm text-on-surface"
              />
            </div>
          );
        }
        const multipla = campo.tipo === 'multipla_escolha';
        const marcados = Array.isArray(valor) ? valor : typeof valor === 'string' && valor ? [valor] : [];
        return (
          <fieldset key={campo.id} className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low flex flex-col justify-between gap-2">
            {/* A legenda é o próprio título visível: o texto da pergunta aparece uma vez só */}
            <legend className="float-left w-full text-xs font-bold text-on-surface">{titulo}</legend>
            {campo.ajuda && <p className="clear-left text-xs text-on-surface-variant">{campo.ajuda}</p>}
            <div className="clear-left flex flex-wrap gap-1.5">
              {opcoesDoCampo(campo).map((opcao) => {
                const ativo = marcados.includes(opcao);
                return (
                  <button
                    key={opcao} type="button" disabled={desabilitado} aria-pressed={ativo}
                    aria-label={`${campo.rotulo}: ${opcao}`}
                    onClick={() => onChange(campo.id, multipla
                      ? (ativo ? marcados.filter((m) => m !== opcao) : [...marcados, opcao])
                      // Tocar de novo na opção marcada desmarca (resposta opcional volta a ficar em branco)
                      : (ativo ? '' : opcao))}
                    className={botao(ativo)}
                  >
                    {opcao}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
