import WhatsappSession from '../models/whatsappSessionModel.js';
import whatsappService from '../services/whatsappService.js';

/**
 * Controller per gestire le Sessioni WhatsApp
 */

/**
 * Ottieni tutte le sessioni dell'utente
 * GET /whatsapp-sessions
 */
export const getSessions = async (req, res) => {
  try {
    const userId = req.user._id;

    const sessions = await WhatsappSession.findByOwner(userId);

    // Aggiungi info sullo stato del client per ogni sessione
    const sessionsWithStatus = await Promise.all(
      sessions.map(async (session) => {
        const status = await whatsappService.getSessionStatus(session.sessionId);
        return {
          ...session.toObject(),
          clientConnected: status.clientConnected || false,
          isExpired: session.isExpired()
        };
      })
    );

    res.json({
      success: true,
      data: {
        sessions: sessionsWithStatus
      }
    });

  } catch (error) {
    console.error('Errore ottenimento sessioni:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni una sessione specifica
 * GET /whatsapp-sessions/:sessionId
 */
export const getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    }).populate('owner', 'firstName lastName email');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Ottieni stato aggiornato
    const status = await whatsappService.getSessionStatus(sessionId);
    console.log(`🔍 getSession ${sessionId} - DB: ${session.status}, Real: ${status.realStatus}, Connected: ${status.clientConnected}`);

    // NUOVO: Forza sincronizzazione database se lo stato è cambiato
    let updatedSession = session;
    if (status.clientConnected && status.realStatus === 'connected' && session.status !== 'connected') {
      
      console.log(`🔄 Aggiornamento automatico stato sessione ${sessionId}: ${session.status} → ${status.realStatus}`);
      
      updatedSession = await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: status.realStatus,
          phoneNumber: status.phoneNumber,
          lastActivity: new Date(),
          connectionInfo: {
            ...session.connectionInfo,
            connectedAt: session.connectionInfo?.connectedAt || new Date(),
            lastSeen: new Date(),
            platform: 'WhatsApp Web'
          },
          qrCode: null, // Rimuovi QR code quando connesso
          qrGeneratedAt: null
        },
        { new: true }
      ).populate('owner', 'firstName lastName email');
      
      console.log(`✅ Sessione ${sessionId} aggiornata a connected`);
    }

    res.json({
      success: true,
      data: {
        ...updatedSession.toObject(),
        clientConnected: status.clientConnected || false,
        isExpired: updatedSession.isExpired()
      }
    });

  } catch (error) {
    console.error('Errore ottenimento sessione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Crea una nuova sessione WhatsApp
 * POST /whatsapp-sessions
 */
export const createSession = async (req, res) => {
  console.log('📥 Richiesta creazione sessione ricevuta:', { name: req.body.name, sessionId: req.body.sessionId });
  
  try {
    const userId = req.user._id;
    const { name, sessionId } = req.body;

    console.log('👤 User ID:', userId);
    console.log('📝 Dati sessione:', { name, sessionId });

    if (!name || !sessionId) {
      console.log('❌ Dati mancanti');
      return res.status(400).json({
        success: false,
        message: 'Nome e Session ID sono obbligatori'
      });
    }

    // Verifica che il sessionId sia unico
    const existingSession = await WhatsappSession.findOne({ sessionId });
    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: 'Session ID già in uso'
      });
    }

    // Verifica limite sessioni per utente (max 3)
    const userSessionsCount = await WhatsappSession.countDocuments({ owner: userId });
    if (userSessionsCount >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Limite massimo di 3 sessioni per utente raggiunto'
      });
    }

    // Salva la sessione nel database PRIMA di avviare OpenWA
    console.log('💾 Salvando sessione nel database...');
    const session = new WhatsappSession({
      sessionId,
      name,
      phoneNumber: 'In attesa di connessione...',
      owner: userId,
      createdBy: userId,
      status: 'connecting'
    });
    await session.save();

    console.log('✅ Sessione salvata nel database:', session._id);
    console.log('📤 Inviando risposta immediata al frontend...');

    // RISPONDE IMMEDIATAMENTE al frontend
    res.status(201).json({
      success: true,
      data: session,
      message: 'Sessione creata con successo. OpenWA si sta avviando...'
    });

    console.log('✅ Risposta inviata al frontend');

    // AVVIA OpenWA in background (non aspetta il completamento)
    console.log('🚀 Avviando OpenWA in background...');
    whatsappService.createSession({
      sessionId,
      name,
      owner: userId
    }).then(() => {
      console.log('✅ OpenWA avviato con successo per sessione:', sessionId);
      
      // Forza controllo immediato della sessione dopo 10 secondi
      setTimeout(async () => {
        try {
          const { default: sessionMonitorService } = await import('../services/sessionMonitorService.js');
          await sessionMonitorService.checkSession(sessionId);
          console.log(`🔍 Controllo post-creazione completato per ${sessionId}`);
        } catch (error) {
          console.error(`❌ Errore controllo post-creazione ${sessionId}:`, error);
        }
      }, 10000);
      
    }).catch(error => {
      console.error('❌ Errore avvio OpenWA per sessione:', sessionId, error);
      // Aggiorna lo stato in caso di errore
      WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'error', 
          lastActivity: new Date(),
          $push: {
            eventLogs: {
              event: 'openwa_error',
              data: {
                error: error.message,
                timestamp: new Date()
              }
            }
          }
        }
      ).catch(updateError => {
        console.error('❌ Errore aggiornamento stato errore:', updateError);
      });
    });

  } catch (error) {
    console.error('Errore creazione sessione:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna una sessione
 * PUT /whatsapp-sessions/:sessionId
 */
export const updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;
    const { name, config } = req.body;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Aggiorna solo se la sessione non è attiva
    if (session.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'Impossibile modificare una sessione attiva'
      });
    }

    if (name) session.name = name;
    if (config) session.config = { ...session.config, ...config };

    await session.save();

    res.json({
      success: true,
      data: session,
      message: 'Sessione aggiornata con successo'
    });

  } catch (error) {
    console.error('Errore aggiornamento sessione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Disconnetti una sessione
 * POST /whatsapp-sessions/:sessionId/disconnect
 */
export const disconnectSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Disconnetti tramite il servizio
    await whatsappService.disconnectSession(sessionId);

    res.json({
      success: true,
      message: 'Sessione disconnessa con successo'
    });

  } catch (error) {
    console.error('Errore disconnessione sessione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Riconnetti una sessione
 * POST /whatsapp-sessions/:sessionId/reconnect
 */
export const reconnectSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Prima disconnetti se necessario
    if (session.isActive()) {
      await whatsappService.disconnectSession(sessionId);
      // Attendi un po' prima di riconnettere
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Riconnetti
    await whatsappService.createSession({
      sessionId: session.sessionId,
      name: session.name,
      owner: userId
    });

    res.json({
      success: true,
      message: 'Riconnessione avviata. Controlla il QR code se necessario.'
    });

  } catch (error) {
    console.error('Errore riconnessione sessione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina una sessione
 * DELETE /whatsapp-sessions/:sessionId
 */
export const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Verifica che non ci siano campagne attive
    const { WhatsappCampaign } = await import('../models/whatsappCampaignModel.js');
    const activeCampaigns = await WhatsappCampaign.countDocuments({
      whatsappSessionId: sessionId,
      status: { $in: ['running', 'scheduled'] }
    });

    if (activeCampaigns > 0) {
      return res.status(400).json({
        success: false,
        message: 'Impossibile eliminare una sessione con campagne attive'
      });
    }

    // Disconnetti se necessario
    if (session.isActive()) {
      await whatsappService.disconnectSession(sessionId);
    }

    // Elimina dal database
    await WhatsappSession.findByIdAndDelete(session._id);

    res.json({
      success: true,
      message: 'Sessione eliminata con successo'
    });

  } catch (error) {
    console.error('Errore eliminazione sessione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni QR code per una sessione
 * GET /whatsapp-sessions/:sessionId/qr
 */
export const getQrCode = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    if (!session.qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code non disponibile. Verifica lo stato della sessione.'
      });
    }

    // Verifica che il QR non sia scaduto (5 minuti)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (session.qrGeneratedAt < fiveMinutesAgo) {
      return res.status(410).json({
        success: false,
        message: 'QR code scaduto. Riconnetti la sessione.'
      });
    }

    res.json({
      success: true,
      data: {
        qrCode: session.qrCode,
        generatedAt: session.qrGeneratedAt,
        expiresAt: new Date(session.qrGeneratedAt.getTime() + 5 * 60 * 1000)
      }
    });

  } catch (error) {
    console.error('Errore ottenimento QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Invia messaggio di test
 * POST /whatsapp-sessions/:sessionId/test-message
 */
export const sendTestMessage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        message: 'Numero di telefono e messaggio sono obbligatori'
      });
    }

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    if (!session.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'Sessione non attiva'
      });
    }

    // Invia il messaggio di test
    const messageId = await whatsappService.sendMessage(sessionId, phoneNumber, message);

    res.json({
      success: true,
      data: {
        messageId,
        sentAt: new Date()
      },
      message: 'Messaggio di test inviato con successo'
    });

  } catch (error) {
    console.error('Errore invio messaggio test:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Errore interno del server'
    });
  }
};

/**
 * Ottieni statistiche sessione
 * GET /whatsapp-sessions/:sessionId/stats
 */
export const getSessionStats = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const session = await WhatsappSession.findOne({
      sessionId,
      owner: userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata'
      });
    }

    // Ottieni statistiche campagne per questa sessione
    const { WhatsappCampaign } = await import('../models/whatsappCampaignModel.js');
    const campaigns = await WhatsappCampaign.find({
      whatsappSessionId: sessionId,
      owner: userId
    });

    const campaignStats = campaigns.reduce((acc, campaign) => {
      acc.total += 1;
      acc[campaign.status] = (acc[campaign.status] || 0) + 1;
      acc.totalMessagesSent += campaign.stats.messagesSent;
      acc.totalReplies += campaign.stats.repliesReceived;
      return acc;
    }, {
      total: 0,
      draft: 0,
      scheduled: 0,
      running: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
      totalMessagesSent: 0,
      totalReplies: 0
    });

    res.json({
      success: true,
      data: {
        session: session.stats,
        campaigns: campaignStats,
        connection: {
          status: session.status,
          connectedAt: session.connectionInfo?.connectedAt,
          lastActivity: session.lastActivity,
          isActive: session.isActive(),
          isExpired: session.isExpired()
        }
      }
    });

  } catch (error) {
    console.error('Errore ottenimento statistiche:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 