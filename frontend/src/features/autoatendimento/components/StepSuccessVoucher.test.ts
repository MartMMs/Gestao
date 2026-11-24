import { describe, expect, it } from 'vitest';
import { antecedenciaCheckinMin, mensagemDoVoucher } from './StepSuccessVoucher';
import { dataHumana } from './StepIdentification';

describe('StepSuccessVoucher — máscara de telefone, antecedência e data pt-BR', () => {
  it('formata o telefone na mensagem de WhatsApp do voucher quando whatsappAtivo é true', () => {
    const msg = mensagemDoVoucher({ whatsappAtivo: true }, '11987654321');
    expect(msg).toContain('(11) 98765-4321');
    expect(msg).not.toContain('11987654321');
  });

  it('não menciona WhatsApp na mensagem do voucher quando whatsappAtivo é false', () => {
    expect(mensagemDoVoucher({ whatsappAtivo: false }, '11987654321')).toBe('Apresente este voucher na recepção.');
  });

  it('extrai a antecedência recomendada das orientações de check-in e usa 15 min como padrão', () => {
    expect(antecedenciaCheckinMin(['Chegar com 15 minutos de antecedência na recepção.'])).toBe(15);
    expect(antecedenciaCheckinMin(['Favor comparecer 20 min antes do horário.'])).toBe(20);
    expect(antecedenciaCheckinMin([])).toBe(15);
    expect(antecedenciaCheckinMin(undefined)).toBe(15);
  });

  it('formata a data em pt-BR sem expor formato ISO YYYY-MM-DD', () => {
    const formatada = dataHumana('2026-11-23');
    expect(formatada).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(formatada).toContain('23/11');
  });
});
