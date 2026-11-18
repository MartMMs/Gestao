import { Router, type NextFunction, type Request, type Response } from 'express';
import { usuarioEhAdmin, verificarSupervisorToken } from '../auth';
import { registrarAuditoria } from '../lib/auditoria';
import { prisma } from '../db';
import { getEmpresaConfig } from '../services/configService';
import { validarMensagensLembrete } from '../../shared/mensagemLembrete';
import { conectarWhatsappQr, desconectarWhatsappQr, estadoWhatsappQr } from '../services/whatsappQr';

// Conexão do WhatsApp por QR code (lembretes). Só o administrador: quem conecta decide por qual número a casa fala.
export function createWhatsappRouter() {
  const router = Router();
  const apenasAdmin = (req: Request, res: Response, next: NextFunction) => (
    usuarioEhAdmin(req) ? next() : res.status(403).json({ erro: 'Apenas o administrador pode conectar o WhatsApp.' })
  );

  router.get('/whatsapp/qr', verificarSupervisorToken, apenasAdmin, (_req, res) => res.json(estadoWhatsappQr()));

  router.post('/whatsapp/qr/conectar', verificarSupervisorToken, apenasAdmin, async (req, res) => {
    try {
      await conectarWhatsappQr();
      await registrarAuditoria(req, { acao: 'whatsapp.conectar', alvo: 'WhatsApp', antes: { conectado: false }, depois: { conectado: true } });
      res.json(estadoWhatsappQr());
    } catch (erro) {
      console.error('[WHATSAPP] Falha ao iniciar a conexão:', erro instanceof Error ? erro.message : 'erro desconhecido');
      res.status(503).json({ erro: 'Não foi possível iniciar a conexão com o WhatsApp. Tente de novo.' });
    }
  });

  router.post('/whatsapp/qr/desconectar', verificarSupervisorToken, apenasAdmin, async (req, res) => {
    await desconectarWhatsappQr();
    await registrarAuditoria(req, { acao: 'whatsapp.desconectar', alvo: 'WhatsApp', antes: { conectado: true }, depois: { conectado: false } });
    res.json(estadoWhatsappQr());
  });

  router.get('/whatsapp/mensagens', verificarSupervisorToken, apenasAdmin, async (_req, res) => {
    res.json({ mensagens: (await getEmpresaConfig()).mensagensLembrete });
  });

  router.put('/whatsapp/mensagens', verificarSupervisorToken, apenasAdmin, async (req, res) => {
    const erro = validarMensagensLembrete(req.body?.mensagens);
    if (erro) return res.status(400).json({ erro });
    const mensagens = (req.body.mensagens as string[]).map((m) => m.trim());
    const antes = (await getEmpresaConfig()).mensagensLembrete;
    await prisma.configuracaoEmpresa.update({ where: { id: 'default' }, data: { mensagensLembrete: mensagens } });
    await registrarAuditoria(req, { acao: 'whatsapp.mensagens', alvo: 'Lembretes do WhatsApp', antes: { quantidade: antes.length }, depois: { quantidade: mensagens.length } });
    res.json({ mensagens });
  });

  return router;
}
