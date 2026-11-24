// Medidas da grade. As horas que ela mostra vêm do horário da empresa (config/funcionamento.ts: horasDaGrade)
export const SCHEDULE_CONFIG = {
  // 1h = 80px: um atendimento de 30 min ainda mostra horário e nome sem cortar
  HOUR_HEIGHT: 80,
  CURRENT_TIME_LINE: {
    // Fica atrás de cards (z-10) e avisos de vazio/indisponível (z-20) para não cruzar por cima de textos
    CONTAINER_CLASS: 'absolute inset-x-0 z-[5] pointer-events-none flex items-center min-w-max',
    DOT_CLASS: 'w-2 h-2 rounded-full bg-error -translate-x-1/2 shrink-0',
    BAR_CLASS: 'h-[2px] w-full bg-error/70',
  },
  get MINUTE_HEIGHT() {
    return this.HOUR_HEIGHT / 60;
  },
} as const;
