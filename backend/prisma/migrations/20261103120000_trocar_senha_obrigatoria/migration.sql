-- Conta criada ou com senha redefinida por outra pessoa precisa trocar a senha no primeiro acesso
ALTER TABLE "Colaborador" ADD COLUMN "trocarSenha" BOOLEAN NOT NULL DEFAULT false;
