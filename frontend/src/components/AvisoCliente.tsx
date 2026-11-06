// Avisos ao lado do nome do cliente: sem ficha de anamnese e/ou ainda não cadastrado na base
export function AvisoCliente({ semFicha, naoCadastrado }: { semFicha?: boolean; naoCadastrado?: boolean }) {
  if (!semFicha && !naoCadastrado) return null;
  const estilo = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap';
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle ml-2">
      {naoCadastrado && (
        <span className={`${estilo} bg-tertiary/15 text-tertiary`} title="Cliente novo: o cadastro é criado ao salvar">
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">person_off</span>Não cadastrado
        </span>
      )}
      {semFicha && (
        <span className={`${estilo} bg-error/10 text-error`} title="Este cliente ainda não tem ficha de anamnese">
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">warning</span>Sem ficha
        </span>
      )}
    </span>
  );
}
