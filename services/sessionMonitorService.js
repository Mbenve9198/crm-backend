import WhatsappSession from '../models/whatsappSessionModel.js';
import whatsappService from './whatsappService.js';

/**
 * Servizio di monitoraggio per le sessioni WhatsApp
 * 
 * Questo servizio:
 * 1. Controlla ogni 5 minuti lo stato delle sessioni attive
 * 2. Sincronizza stato database con stato reale OpenWA
 * 3. Aggiorna automaticamente i dati di connessione
 * 4. Gestisce disconnessioni e riconnessioni automatiche
 */
class SessionMonitorService {
  constructor() {
    this.isRunning = false;
    this.monitorInterval = null;
    this.CHECK_INTERVAL = 5 * 60 * 1000; // 5 minuti
  }

  /**
   * Avvia il monitoraggio automatico
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Monitor sessioni già in esecuzione');
      return;
    }

    console.log('🔍 Avvio monitor sessioni WhatsApp...');
    this.isRunning = true;

    // Primo controllo immediato
    this.checkAllSessions().catch(error => {
      console.error('❌ Errore controllo iniziale sessioni:', error);
    });

    // Controllo periodico ogni 5 minuti
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkAllSessions();
      } catch (error) {
        console.error('❌ Errore monitor sessioni periodico:', error);
      }
    }, this.CHECK_INTERVAL);

    console.log('✅ Monitor sessioni avviato - controllo ogni 5 minuti');
  }

  /**
   * Ferma il monitoraggio
   */
  stop() {
    if (!this.isRunning) return;

    console.log('🛑 Fermando monitor sessioni...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.isRunning = false;
    console.log('✅ Monitor sessioni fermato');
  }

  /**
   * Controlla tutte le sessioni attive
   */
  async checkAllSessions() {
    try {
      // Trova tutte le sessioni che dovrebbero essere attive
      const sessions = await WhatsappSession.find({
        status: { $in: ['connecting', 'qr_ready', 'authenticated', 'connected'] }
      });

      if (sessions.length === 0) {
        console.log('📊 Nessuna sessione attiva da monitorare');
        return;
      }

      console.log(`🔍 Controllo ${sessions.length} sessioni attive...`);

      // Controlla ogni sessione
      const results = await Promise.allSettled(
        sessions.map(session => this.checkSingleSession(session))
      );

      // Riassunto risultati
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`📈 Monitor completato: ${successful} ok, ${failed} errori`);

      // Log errori
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`❌ Errore sessione ${sessions[index].sessionId}:`, result.reason);
        }
      });

    } catch (error) {
      console.error('❌ Errore generale monitor sessioni:', error);
    }
  }

  /**
   * Controlla una singola sessione
   */
  async checkSingleSession(session) {
    const sessionId = session.sessionId;
    console.log(`🔎 Controllo sessione: ${sessionId} (stato DB: ${session.status})`);

    try {
      // Ottieni stato reale da WhatsappService
      const realStatus = await whatsappService.getSessionStatus(sessionId);
      
      // Determina il nuovo stato basato sui dati reali
      const newStatus = this.determineNewStatus(session, realStatus);
      
      // Aggiorna database se necessario
      if (newStatus !== session.status || this.shouldUpdateConnectionInfo(session, realStatus)) {
        await this.updateSessionInDatabase(session, newStatus, realStatus);
      }

      // Log dettagliato
      console.log(`📊 Sessione ${sessionId}: ${session.status} → ${newStatus} ${realStatus.clientConnected ? '🟢' : '🔴'}`);

    } catch (error) {
      console.error(`❌ Errore controllo sessione ${sessionId}:`, error);
      
      // In caso di errore, marca come disconnessa
      if (session.status !== 'error') {
        await this.updateSessionInDatabase(session, 'error', { error: error.message });
      }
    }
  }

  /**
   * Determina il nuovo stato basato sui dati reali
   */
  determineNewStatus(session, realStatus) {
    // Se c'è un errore specifico
    if (realStatus.status === 'error' || realStatus.error) {
      return 'error';
    }

    // Se il client è connesso e autenticato
    if (realStatus.clientConnected && realStatus.phoneNumber && realStatus.phoneNumber !== 'In attesa di connessione...') {
      return 'connected';
    }

    // Se è autenticato ma client non ancora pronto
    if (realStatus.status === 'authenticated') {
      return 'authenticated';
    }

    // Se ha QR code disponibile
    if (realStatus.qrCode && realStatus.status === 'qr_ready') {
      return 'qr_ready';
    }

    // Se sta ancora connettendo
    if (session.status === 'connecting' && !realStatus.clientConnected) {
      return 'connecting';
    }

    // Se era connesso ma ora non più
    if (['connected', 'authenticated'].includes(session.status) && !realStatus.clientConnected) {
      return 'disconnected';
    }

    // Mantieni stato attuale se non ci sono cambiamenti evidenti
    return session.status;
  }

  /**
   * Verifica se le informazioni di connessione devono essere aggiornate
   */
  shouldUpdateConnectionInfo(session, realStatus) {
    // Aggiorna se ci sono nuove informazioni importanti
    if (realStatus.phoneNumber && realStatus.phoneNumber !== session.phoneNumber) {
      return true;
    }

    if (realStatus.qrCode && realStatus.qrCode !== session.qrCode) {
      return true;
    }

    // Aggiorna lastActivity se la sessione è attiva
    if (realStatus.clientConnected) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return !session.lastActivity || session.lastActivity < fiveMinutesAgo;
    }

    return false;
  }

  /**
   * Aggiorna la sessione nel database
   */
  async updateSessionInDatabase(session, newStatus, realStatus) {
    try {
      const updateData = {
        status: newStatus,
        lastActivity: new Date()
      };

      // Aggiorna numero di telefono se disponibile
      if (realStatus.phoneNumber && realStatus.phoneNumber !== 'In attesa di connessione...') {
        updateData.phoneNumber = realStatus.phoneNumber;
      }

      // Aggiorna QR code se disponibile
      if (realStatus.qrCode) {
        updateData.qrCode = realStatus.qrCode;
        updateData.qrGeneratedAt = new Date();
      } else if (newStatus === 'connected') {
        // Rimuovi QR code quando connesso
        updateData.qrCode = null;
        updateData.qrGeneratedAt = null;
      }

      // Aggiorna informazioni di connessione
      if (newStatus === 'connected' && realStatus.clientConnected) {
        updateData.connectionInfo = {
          ...session.connectionInfo,
          connectedAt: session.connectionInfo?.connectedAt || new Date(),
          lastSeen: new Date(),
          platform: 'WhatsApp Web'
        };
      }

      // Aggiungi evento al log
      updateData.$push = {
        eventLogs: {
          event: 'status_change',
          data: {
            oldStatus: session.status,
            newStatus: newStatus,
            clientConnected: realStatus.clientConnected,
            timestamp: new Date(),
            monitoredBy: 'SessionMonitorService'
          }
        }
      };

      await WhatsappSession.findOneAndUpdate(
        { sessionId: session.sessionId },
        updateData
      );

      console.log(`💾 Sessione ${session.sessionId} aggiornata: ${session.status} → ${newStatus}`);

    } catch (error) {
      console.error(`❌ Errore aggiornamento sessione ${session.sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Forza il controllo di una sessione specifica
   */
  async checkSession(sessionId) {
    try {
      const session = await WhatsappSession.findOne({ sessionId });
      if (!session) {
        throw new Error(`Sessione ${sessionId} non trovata`);
      }

      await this.checkSingleSession(session);
      console.log(`✅ Controllo manuale sessione ${sessionId} completato`);

    } catch (error) {
      console.error(`❌ Errore controllo manuale sessione ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Ottieni statistiche del monitor
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.CHECK_INTERVAL,
      nextCheck: this.monitorInterval ? new Date(Date.now() + this.CHECK_INTERVAL) : null
    };
  }
}

// Istanza singleton
const sessionMonitorService = new SessionMonitorService();

export default sessionMonitorService; 