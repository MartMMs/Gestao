-- Restrição de serviço por profissional específico (modo de elegibilidade "profissional")
ALTER TABLE "Servico" ADD COLUMN "profissionaisPermitidos" TEXT[] DEFAULT ARRAY[]::TEXT[];
