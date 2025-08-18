import sessionMonitorService from '../services/sessionMonitorService.js';
import WhatsappSession from '../models/whatsappSessionModel.js';

/**
 * Controller per il monitoraggio delle sessioni WhatsApp
 */

/**
 * Controlla manualmente tutte le sessioni
 * POST /api/session-monitor/check-all
 */
export const checkAllSessions = async (req, res) => {
  try {
    console.log('🔍 Richiesta controllo manuale tutte le sessioni');
    
    await sessionMonitorService.checkAllSessions();
    
    res.status(200).json({
      success: true,
      message: 'Controllo sessioni completato',
      timestamp: new Date()
    });

  } catch (error) {
    console.error('❌ Errore controllo sessioni:', error);
    res.status(500).json({
      success: false,
      message: 'Errore durante il controllo delle sessioni',
      error: error.message
    });
  }
};

/**
 * Controlla una sessione specifica
 * POST /api/session-monitor/check/:sessionId
 */
export const checkSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    console.log(`🔍 Richiesta controllo manuale sessione: ${sessionId}`);
    
    // Verifica che la sessione appartenga all'utente
    const session = await WhatsappSession.findOne({ 
      sessionId,
      owner: userId 
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata o non autorizzata'
      });
    }

    await sessionMonitorService.checkSession(sessionId);
    
    // Restituisci lo stato aggiornato
    const updatedSession = await WhatsappSession.findOne({ sessionId })
      .populate('owner', 'firstName lastName email');
    
    res.status(200).json({
      success: true,
      message: 'Controllo sessione completato',
      data: updatedSession,
      timestamp: new Date()
    });

  } catch (error) {
    console.error(`❌ Errore controllo sessione ${req.params.sessionId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Errore durante il controllo della sessione',
      error: error.message
    });
  }
};

/**
 * Ottieni statistiche del monitor
 * GET /api/session-monitor/stats
 */
export const getMonitorStats = async (req, res) => {
  try {
    const stats = sessionMonitorService.getStats();
    
    // Aggiungi statistiche database
    const totalSessions = await WhatsappSession.countDocuments();
    const activeSessions = await WhatsappSession.countDocuments({
      status: { $in: ['connecting', 'qr_ready', 'authenticated', 'connected'] }
    });
    const connectedSessions = await WhatsappSession.countDocuments({
      status: 'connected'
    });

    res.status(200).json({
      success: true,
      data: {
        monitor: stats,
        database: {
          totalSessions,
          activeSessions,
          connectedSessions,
          lastCheck: new Date()
        }
      }
    });

  } catch (error) {
    console.error('❌ Errore ottenimento statistiche monitor:', error);
    res.status(500).json({
      success: false,
      message: 'Errore durante il recupero delle statistiche',
      error: error.message
    });
  }
};

/**
 * Avvia/ferma il monitor
 * POST /api/session-monitor/toggle
 */
export const toggleMonitor = async (req, res) => {
  try {
    const { action } = req.body; // 'start' o 'stop'
    
    if (action === 'start') {
      sessionMonitorService.start();
      res.status(200).json({
        success: true,
        message: 'Monitor sessioni avviato',
        isRunning: true
      });
    } else if (action === 'stop') {
      sessionMonitorService.stop();
      res.status(200).json({
        success: true,
        message: 'Monitor sessioni fermato',
        isRunning: false
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Azione non valida. Usa "start" o "stop"'
      });
    }

  } catch (error) {
    console.error('❌ Errore toggle monitor:', error);
    res.status(500).json({
      success: false,
      message: 'Errore durante il controllo del monitor',
      error: error.message
    });
  }
};

/**
 * Sincronizza una sessione - forza ricreazione se necessario
 * POST /api/session-monitor/sync/:sessionId
 */
export const syncSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    console.log(`🔄 Richiesta sincronizzazione forzata sessione: ${sessionId}`);
    
    // Verifica che la sessione appartenga all'utente
    const session = await WhatsappSession.findOne({ 
      sessionId,
      owner: userId 
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessione non trovata o non autorizzata'
      });
    }

    // Forza controllo immediato
    await sessionMonitorService.checkSession(sessionId);
    
    // Se ancora non è connessa, prova a riavviare OpenWA
    const updatedSession = await WhatsappSession.findOne({ sessionId });
    
    if (!['connected', 'authenticated'].includes(updatedSession.status)) {
      console.log(`🔄 Riavvio OpenWA per sessione ${sessionId}...`);
      
      // Importa dinamicamente per evitare dipendenze circolari
      const { default: whatsappService } = await import('../services/whatsappService.js');
      
      // Aggiorna stato a connecting
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { status: 'connecting', lastActivity: new Date() }
      );
      
      // Riavvia sessione
      whatsappService.createSession({
        sessionId: session.sessionId,
        name: session.name,
        owner: session.owner
      }).catch(error => {
        console.error(`❌ Errore riavvio sessione ${sessionId}:`, error);
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Sincronizzazione sessione avviata',
      data: updatedSession,
      timestamp: new Date()
    });

  } catch (error) {
    console.error(`❌ Errore sincronizzazione sessione ${req.params.sessionId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Errore durante la sincronizzazione della sessione',
      error: error.message
    });
  }
}; 