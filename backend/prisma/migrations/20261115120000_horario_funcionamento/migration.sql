-- Horário de funcionamento configurável (antes fixo no código: 09:00 às 21:00, todos os dias)
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "horaAbertura" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "horaFechamento" TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "horaLimiteAgendamento" TEXT;
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "diasFuncionamento" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];
