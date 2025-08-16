import { create, Client, ev } from '@open-wa/wa-automate';
import WhatsappSession from '../models/whatsappSessionModel.js';
import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Servizio per gestire le connessioni WhatsApp con OpenWA
 */
class WhatsappService {
  constructor() {
    this.sessions = new Map(); // sessionId -> Client instance
    this.qrCodeListeners = new Map(); // sessionId -> QR callback
    this.messageProcessors = new Map(); // sessionId -> message processor interval
    this.isInitialized = false;
  }

  /**
   * Configurazione minimal per produzione - SOLO browserRevision
   */
  getProductionConfig() {
    console.log('🚀 Produzione: configurazione minimal con SOLO browserRevision');
    
    // Configurazione minimal - SOLO browserRevision (sovrascrive tutto)
    const config = {
      browserRevision: process.env.OPENWA_BROWSER_REVISION || '737027',
      headless: true,
      cacheEnabled: false
    };
    
    console.log('📦 Config minimal browserRevision:', config);
    return config;
  }

  /**
   * Inizializza il servizio
   */
  async initialize() {
    if (this.isInitialized) return;

    console.log('🟢 Inizializzazione WhatsApp Service...');
    
    // Verifica licenza OpenWA
    if (process.env.OPENWA_LICENSE_KEY) {
      console.log('🔑 OpenWA License Key caricata');
    } else {
      console.log('⚠️  OpenWA in modalità gratuita (limitazioni sui media)');
      console.log('💡 Per funzionalità complete: https://gum.co/open-wa');
    }
    
    // Setup event listeners globali per OpenWA
    this.setupGlobalEventListeners();
    
    // Riconnetti le sessioni esistenti
    await this.reconnectExistingSessions();
    
    // Avvia il processore delle campagne
    this.startCampaignProcessor();
    
    this.isInitialized = true;
    console.log('✅ WhatsApp Service inizializzato');
  }

  /**
   * Setup dei listener globali per gli eventi OpenWA
   */
  setupGlobalEventListeners() {
    // Listener per QR codes
    ev.on('qr.**', async (qrcode, sessionId) => {
      console.log(`📱 QR code ricevuto per sessione: ${sessionId}`);
      await this.handleQrCode(sessionId, qrcode);
    });

    // Listener per autenticazione
    ev.on('authenticated.**', async (data, sessionId) => {
      console.log(`✅ Sessione autenticata: ${sessionId}`);
      await this.handleAuthenticated(sessionId, data);
    });

    // Listener per disconnessioni
    ev.on('disconnected.**', async (data, sessionId) => {
      console.log(`❌ Sessione disconnessa: ${sessionId}`);
      await this.handleDisconnected(sessionId, data);
    });

    // Listener per stato pronto
    ev.on('ready.**', async (data, sessionId) => {
      console.log(`🚀 Sessione pronta: ${sessionId}`);
      await this.handleReady(sessionId, data);
    });
  }

  /**
   * Crea una nuova sessione WhatsApp
   */
  async createSession(sessionData) {
    const { sessionId, name, owner } = sessionData;
    
    console.log(`🔄 Creazione sessione WhatsApp: ${sessionId}`);

    try {
      // Salva la sessione nel database
      const session = new WhatsappSession({
        sessionId,
        name,
        phoneNumber: 'In attesa di connessione...',
        owner,
        createdBy: owner,
        status: 'connecting'
      });
      await session.save();

      // Configurazione OpenWA ottimizzata basata sulla documentazione
      const config = {
        sessionId,
        headless: process.env.OPENWA_HEADLESS === 'true' || true,
        autoRefresh: true,
        qrTimeout: 30,
        authTimeout: 30,
        cacheEnabled: false,
        hostNotificationLang: 'IT',
        sessionDataPath: process.env.OPENWA_SESSION_DATA_PATH || './wa-sessions',
        devtools: false,

        // Chrome configuration: SOLO browserRevision in produzione per evitare conflitti
        ...(process.env.NODE_ENV === 'production' ? 
          this.getProductionConfig() : process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH ? {
          executablePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
          useChrome: false
        } : {
          useChrome: true  // In sviluppo, cerca Chrome locale
        }),
        // Configurazione per ambienti headless (rimosso chromiumArgs per multi-device)
        // NOTA: chromiumArgs rimossi perché causano problemi con multi-device secondo OpenWA
        // Aggiungi la licenza se disponibile
        ...(process.env.OPENWA_LICENSE_KEY && { 
          licenseKey: process.env.OPENWA_LICENSE_KEY 
        }),
        ...session.config
      };

      // Crea la sessione OpenWA
      const client = await create(config);
      
      // Salva il client nella mappa
      this.sessions.set(sessionId, client);
      
      // Setup listener per messaggi
      this.setupMessageListeners(client, sessionId);
      
      console.log(`✅ Sessione creata: ${sessionId}`);
      return session;

    } catch (error) {
      console.error(`❌ Errore creazione sessione ${sessionId}:`, error);
      
      // Aggiorna lo stato in caso di errore
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { status: 'error', lastActivity: new Date() }
      );
      
      throw error;
    }
  }

  /**
   * Setup listener per messaggi in arrivo e in uscita
   */
  setupMessageListeners(client, sessionId) {
    // Listener per tutti i messaggi (in arrivo e in uscita)
    client.onAnyMessage(async (message) => {
      try {
        await this.handleIncomingMessage(sessionId, message);
      } catch (error) {
        console.error(`Errore gestione messaggio per ${sessionId}:`, error);
      }
    });
  }

  /**
   * Gestisce QR code ricevuto
   */
  async handleQrCode(sessionId, qrcode) {
    try {
      // Aggiorna nel database
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          qrCode: qrcode,
          qrGeneratedAt: new Date(),
          status: 'qr_ready',
          lastActivity: new Date()
        }
      );

      console.log(`📱 QR code aggiornato per sessione: ${sessionId}`);
    } catch (error) {
      console.error(`Errore salvataggio QR per ${sessionId}:`, error);
    }
  }

  /**
   * Gestisce autenticazione completata
   */
  async handleAuthenticated(sessionId, data) {
    try {
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'authenticated',
          qrCode: null,
          lastActivity: new Date()
        }
      );
    } catch (error) {
      console.error(`Errore aggiornamento autenticazione per ${sessionId}:`, error);
    }
  }

  /**
   * Gestisce sessione pronta
   */
  async handleReady(sessionId, data) {
    try {
      const client = this.sessions.get(sessionId);
      if (!client) return;

      // Ottieni informazioni sulla connessione
      const hostAccount = await client.getHostNumber();
      
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'connected',
          phoneNumber: hostAccount,
          connectionInfo: {
            connectedAt: new Date(),
            platform: 'WhatsApp Web',
            lastSeen: new Date()
          },
          lastActivity: new Date()
        }
      );

      console.log(`🚀 Sessione pronta: ${sessionId} - ${hostAccount}`);
    } catch (error) {
      console.error(`Errore gestione ready per ${sessionId}:`, error);
    }
  }

  /**
   * Gestisce disconnessione
   */
  async handleDisconnected(sessionId, data) {
    try {
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'disconnected',
          lastActivity: new Date()
        }
      );

      // Rimuovi dalla mappa delle sessioni attive
      this.sessions.delete(sessionId);
      
      console.log(`❌ Sessione disconnessa: ${sessionId}`);
    } catch (error) {
      console.error(`Errore gestione disconnessione per ${sessionId}:`, error);
    }
  }

  /**
   * Gestisce messaggi in arrivo
   */
  async handleIncomingMessage(sessionId, message) {
    try {
      // Aggiorna statistiche sessione
      const session = await WhatsappSession.findOne({ sessionId });
      if (!session) return;

      if (!message.fromMe) {
        session.incrementMessagesReceived();
        await session.save();
      }

      // Trova il contatto correlato
      const phoneNumber = message.from.replace('@c.us', '');
      const contact = await Contact.findOne({
        $or: [
          { phone: phoneNumber },
          { phone: `+${phoneNumber}` },
          { phone: phoneNumber.replace(/^0/, '+39') }
        ]
      });

      if (contact) {
        // Salva come activity
        const activity = new Activity({
          contact: contact._id,
          type: 'whatsapp',
          title: message.fromMe ? 'Messaggio WhatsApp inviato' : 'Messaggio WhatsApp ricevuto',
          description: message.body || '[Media]',
          data: {
            messageText: message.body,
            messageId: message.id,
            messageType: message.type,
            fromMe: message.fromMe,
            sessionId: sessionId
          },
          createdBy: session.owner
        });
        await activity.save();

        // Se è una risposta, aggiorna statistiche campagne
        if (!message.fromMe) {
          await this.updateCampaignReplies(sessionId, contact._id);
        }
      }

    } catch (error) {
      console.error('Errore gestione messaggio in arrivo:', error);
    }
  }

  /**
   * Aggiorna statistiche risposte per le campagne
   */
  async updateCampaignReplies(sessionId, contactId) {
    try {
      const campaigns = await WhatsappCampaign.find({
        whatsappSessionId: sessionId,
        status: 'running',
        'messageQueue.contactId': contactId
      });

      for (const campaign of campaigns) {
        campaign.stats.repliesReceived += 1;
        await campaign.save();
      }
    } catch (error) {
      console.error('Errore aggiornamento risposte campagne:', error);
    }
  }

  /**
   * Invia un messaggio WhatsApp
   */
  async sendMessage(sessionId, phoneNumber, message, attachments = []) {
    try {
      const client = this.sessions.get(sessionId);
      if (!client) {
        throw new Error(`Sessione ${sessionId} non trovata o non connessa`);
      }

      const chatId = `${phoneNumber.replace(/[^0-9]/g, '')}@c.us`;
      let messageId;

      // Invia allegati se presenti
      for (const attachment of attachments) {
        switch (attachment.type) {
          case 'image':
            messageId = await client.sendImage(chatId, attachment.url, attachment.filename, attachment.caption || '');
            break;
          case 'audio':
            messageId = await client.sendPtt(chatId, attachment.url);
            break;
          case 'video':
            messageId = await client.sendFile(chatId, attachment.url, attachment.filename, attachment.caption || '');
            break;
          case 'document':
            messageId = await client.sendFile(chatId, attachment.url, attachment.filename, attachment.caption || '');
            break;
        }
      }

      // Invia il messaggio di testo se presente
      if (message && message.trim()) {
        messageId = await client.sendText(chatId, message);
      }

      // Aggiorna statistiche sessione
      const session = await WhatsappSession.findOne({ sessionId });
      if (session) {
        session.incrementMessagesSent();
        await session.save();
      }

      return messageId;

    } catch (error) {
      console.error(`Errore invio messaggio da ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Ottiene lo stato di una sessione
   */
  async getSessionStatus(sessionId) {
    try {
      const session = await WhatsappSession.findOne({ sessionId });
      if (!session) {
        return { status: 'not_found' };
      }

      const client = this.sessions.get(sessionId);
      const isClientActive = client ? await client.isConnected() : false;

      return {
        ...session.toObject(),
        clientConnected: isClientActive
      };
    } catch (error) {
      console.error(`Errore ottenimento stato ${sessionId}:`, error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Disconnette una sessione
   */
  async disconnectSession(sessionId) {
    try {
      const client = this.sessions.get(sessionId);
      if (client) {
        await client.logout();
        this.sessions.delete(sessionId);
      }

      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'disconnected',
          qrCode: null,
          lastActivity: new Date()
        }
      );

      console.log(`🔌 Sessione disconnessa: ${sessionId}`);
    } catch (error) {
      console.error(`Errore disconnessione ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Riconnette le sessioni esistenti al riavvio
   */
  async reconnectExistingSessions() {
    try {
      const sessions = await WhatsappSession.find({
        status: { $in: ['connected', 'authenticated'] }
      });

      for (const session of sessions) {
        try {
          console.log(`🔄 Riconnessione sessione: ${session.sessionId}`);
          
          const config = {
            sessionId: session.sessionId,
            headless: process.env.OPENWA_HEADLESS === 'true' || true,
            autoRefresh: true,
            sessionDataPath: process.env.OPENWA_SESSION_DATA_PATH || './wa-sessions',

            // Chrome configuration: SOLO browserRevision in produzione per evitare conflitti
            ...(process.env.NODE_ENV === 'production' ? 
              this.getProductionConfig() : process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH ? {
              executablePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
              useChrome: false
            } : {
              useChrome: true  // In sviluppo, cerca Chrome locale
            }),
            // Configurazione per ambienti headless (rimosso chromiumArgs per multi-device)
            // NOTA: chromiumArgs rimossi perché causano problemi con multi-device secondo OpenWA
            // Aggiungi la licenza se disponibile
            ...(process.env.OPENWA_LICENSE_KEY && { 
              licenseKey: process.env.OPENWA_LICENSE_KEY 
            }),
            ...session.config
          };

          const client = await create(config);
          this.sessions.set(session.sessionId, client);
          this.setupMessageListeners(client, session.sessionId);

        } catch (error) {
          console.error(`Errore riconnessione ${session.sessionId}:`, error);
          await session.updateStatus('error');
          await session.save();
        }
      }
    } catch (error) {
      console.error('Errore riconnessione sessioni:', error);
    }
  }

  /**
   * Avvia il processore delle campagne
   */
  startCampaignProcessor() {
    // Controlla ogni 30 secondi per campagne da eseguire
    setInterval(async () => {
      try {
        await this.processCampaigns();
      } catch (error) {
        console.error('Errore processore campagne:', error);
      }
    }, 30000);

    console.log('📧 Processore campagne avviato');
  }

  /**
   * Processa le campagne attive
   */
  async processCampaigns() {
    try {
      // Trova campagne programmate da avviare
      const scheduledCampaigns = await WhatsappCampaign.findScheduledToRun();
      for (const campaign of scheduledCampaigns) {
        await this.startCampaign(campaign._id);
      }

      // Processa campagne in esecuzione
      const runningCampaigns = await WhatsappCampaign.find({ status: 'running' });
      for (const campaign of runningCampaigns) {
        await this.processCampaignMessages(campaign);
      }

    } catch (error) {
      console.error('Errore processamento campagne:', error);
    }
  }

  /**
   * Avvia una campagna
   */
  async startCampaign(campaignId) {
    try {
      const campaign = await WhatsappCampaign.findById(campaignId)
        .populate('messageQueue.contactId');

      if (!campaign || !campaign.canStart()) {
        return;
      }

      console.log(`🚀 Avvio campagna: ${campaign.name}`);

      campaign.status = 'running';
      campaign.actualStartedAt = new Date();
      await campaign.save();

      console.log(`✅ Campagna avviata: ${campaign.name}`);

    } catch (error) {
      console.error(`Errore avvio campagna ${campaignId}:`, error);
    }
  }

  /**
   * Processa i messaggi di una campagna
   */
  async processCampaignMessages(campaign) {
    try {
      // Ottieni messaggi da inviare
      const pendingMessages = campaign.getNextMessages(5); // Massimo 5 alla volta
      
      if (pendingMessages.length === 0) {
        // Verifica se la campagna è completata
        const allSent = campaign.messageQueue.every(m => 
          ['sent', 'delivered', 'read', 'failed'].includes(m.status)
        );
        
        if (allSent) {
          campaign.status = 'completed';
          campaign.completedAt = new Date();
          await campaign.save();
          console.log(`✅ Campagna completata: ${campaign.name}`);
        }
        
        return;
      }

      // Controlla limite di velocità
      const now = new Date();
      const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
      const sentInLastHour = campaign.messageQueue.filter(m => 
        m.sentAt && m.sentAt >= lastHour
      ).length;

      if (sentInLastHour >= campaign.timing.messagesPerHour) {
        console.log(`⏰ Limite velocità raggiunto per campagna: ${campaign.name}`);
        return;
      }

      // Invia messaggi
      for (const messageData of pendingMessages) {
        try {
          await this.sendCampaignMessage(campaign, messageData);
          
          // Attendi l'intervallo specificato
          await this.sleep(campaign.timing.intervalBetweenMessages * 1000);
          
        } catch (error) {
          console.error(`Errore invio messaggio campagna:`, error);
          campaign.markMessageFailed(messageData.contactId, error.message);
        }
      }

      await campaign.save();

    } catch (error) {
      console.error('Errore processamento messaggi campagna:', error);
    }
  }

  /**
   * Invia un singolo messaggio di campagna
   */
  async sendCampaignMessage(campaign, messageData) {
    try {
      const contact = await Contact.findById(messageData.contactId);
      if (!contact || !contact.phone) {
        throw new Error('Contatto non valido o senza numero');
      }

      // Invia il messaggio
      const messageId = await this.sendMessage(
        campaign.whatsappSessionId,
        contact.phone,
        messageData.compiledMessage,
        campaign.attachments
      );

      // Aggiorna stato messaggio
      campaign.markMessageSent(messageData.contactId, messageId);

      // Crea activity
      const activity = new Activity({
        contact: contact._id,
        type: 'whatsapp',
        title: `Campagna: ${campaign.name}`,
        description: messageData.compiledMessage,
        data: {
          messageText: messageData.compiledMessage,
          messageId: messageId,
          campaignId: campaign._id,
          campaignName: campaign.name,
          sessionId: campaign.whatsappSessionId
        },
        createdBy: campaign.owner
      });
      await activity.save();

      console.log(`📧 Messaggio campagna inviato a ${contact.name}`);

    } catch (error) {
      console.error('Errore invio messaggio campagna:', error);
      throw error;
    }
  }

  /**
   * Utility per attendere
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup del servizio
   */
  async cleanup() {
    console.log('🧹 Cleanup WhatsApp Service...');
    
    // Disconnetti tutte le sessioni
    for (const [sessionId, client] of this.sessions) {
      try {
        await client.logout();
      } catch (error) {
        console.error(`Errore logout ${sessionId}:`, error);
      }
    }
    
    this.sessions.clear();
    console.log('✅ Cleanup completato');
  }
}

// Istanza singleton
const whatsappService = new WhatsappService();

export default whatsappService; 