import { create, Client, ev } from '@open-wa/wa-automate';
import WhatsappSession from '../models/whatsappSessionModel.js';
import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import redisManager from '../config/redis.js';
import messageLockingService from './messageLocking.js';
import smartRateLimiter from './smartRateLimiter.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Servizio per gestire le connessioni WhatsApp con OpenWA
 */
class WhatsappService {
  constructor() {
    this.sessions = new Map(); // sessionId -> Client instance
    this.qrCodeListeners = new Map(); // sessionId -> QR callback
    this.messageProcessors = new Map(); // sessionId -> message processor interval
    this.isInitialized = false;
    
    // Configura immediatamente il percorso di storage per node-persist
    this.setupStoragePathSync();
  }

  /**
   * Configura immediatamente il percorso di storage per node-persist e OpenWA (sincrono)
   */
  setupStoragePathSync() {
    try {
      // Determina il percorso di storage appropriato per l'ambiente
      let storagePath;
      
      if (process.env.NODE_ENV === 'production') {
        // In produzione (Railway), usa la directory tmp che ha permessi di scrittura
        storagePath = process.env.OPENWA_STORAGE_PATH || path.join(os.tmpdir(), 'wa-storage');
      } else {
        // In sviluppo, usa la directory del progetto
        storagePath = process.env.OPENWA_STORAGE_PATH || path.join(process.cwd(), 'wa-storage');
      }

      // Setta immediatamente la variabile d'ambiente per OpenWA PRIMA di qualsiasi altra inizializzazione
      process.env.OPENWA_SESSION_DATA_PATH = storagePath;
      
      console.log(`📁 Storage path configurato: ${storagePath}`);
      
      // Configura variabili d'ambiente aggiuntive per forzare l'uso del percorso corretto
      process.env.NODE_PERSIST_DIR = path.join(storagePath, 'node-persist');
      
      console.log(`🔧 NODE_PERSIST_DIR impostato: ${process.env.NODE_PERSIST_DIR}`);
      
    } catch (error) {
      console.error('❌ Errore setup storage path sincrono:', error);
      // Fallback alla directory temporanea di sistema
      const fallbackPath = path.join(os.tmpdir(), 'wa-fallback');
      process.env.OPENWA_SESSION_DATA_PATH = fallbackPath;
      process.env.NODE_PERSIST_DIR = path.join(fallbackPath, 'node-persist');
      console.log(`🔄 Fallback storage path: ${fallbackPath}`);
    }
  }

  /**
   * Configura il percorso di storage per node-persist e OpenWA (asincrono per creazione directory)
   */
  async setupStoragePath() {
    try {
      const storagePath = process.env.OPENWA_SESSION_DATA_PATH;
      
      if (!storagePath) {
        console.warn('⚠️ OPENWA_SESSION_DATA_PATH non configurato, uso setupStoragePathSync');
        this.setupStoragePathSync();
        return;
      }

      // Crea la directory se non esiste
      try {
        await fs.mkdir(storagePath, { recursive: true });
        await fs.mkdir(path.join(storagePath, 'node-persist'), { recursive: true });
        await fs.mkdir(path.join(storagePath, 'sessions'), { recursive: true });
        console.log(`📁 Directory storage WhatsApp creata: ${storagePath}`);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          console.warn(`⚠️ Avviso creazione directory storage: ${error.message}`);
        }
      }

      // Configura node-persist per OpenWA (se disponibile)
      if (global.nodeStorage) {
        await global.nodeStorage.init({
          dir: path.join(storagePath, 'node-persist'),
          stringify: JSON.stringify,
          parse: JSON.parse,
          encoding: 'utf8',
          logging: false,
          ttl: false,
          forgiveParseErrors: true
        });
        console.log('🔧 node-persist configurato per OpenWA');
      }
      
    } catch (error) {
      console.error('❌ Errore setup storage path asincrono:', error);
    }
  }

  /**
   * Configurazione per produzione - forza CHROME_PATH vuoto per disabilitare chrome-launcher
   */
  getProductionConfig() {
    console.log('🚀 Produzione: disabilito chrome-launcher forzando CHROME_PATH vuoto');
    
    // SOLUZIONE BASATA SU RICERCA INTERNET:
    // ChromeDriver 128+ ha bug con porte casuali e chrome-launcher
    // Forzo CHROME_PATH vuoto per bypassare chrome-launcher
    
    const config = {
      browserRevision: process.env.OPENWA_BROWSER_REVISION || '737027',
      headless: true,
      cacheEnabled: false,
      // Forza vuoto per disabilitare chrome-launcher detection
      executablePath: '',
      useChrome: false
    };
    
    console.log('📦 Config con chrome-launcher disabilitato:', config);
    return config;
  }

  /**
   * Inizializza il servizio
   */
  async initialize() {
    if (this.isInitialized) return;

    console.log('🟢 Inizializzazione WhatsApp Service v2...');
    
    // Setup del percorso di storage per node-persist
    await this.setupStoragePath();
    
    // Inizializza Redis per locking e rate limiting
    await this.initializeRedis();
    
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
    
    // Avvia il processore delle campagne (migliorato)
    this.startSmartCampaignProcessor();
    
    // Avvia il monitor delle sessioni
    this.startSessionMonitor();
    
    this.isInitialized = true;
    console.log('✅ WhatsApp Service v2 inizializzato con Redis + Smart Rate Limiting');
  }

  /**
   * Inizializza Redis per il sistema
   */
  async initializeRedis() {
    try {
      await redisManager.initialize();
      console.log('✅ Redis initialized for WhatsApp service');
    } catch (error) {
      console.warn('⚠️ Redis initialization failed, continuing without Redis features');
      console.warn('Features disabled: message locking, distributed rate limiting');
    }
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
      // Assicurati che il percorso di storage sia configurato PRIMA di creare la sessione
      if (!process.env.OPENWA_SESSION_DATA_PATH) {
        console.log('🔧 Configurazione storage path di emergenza...');
        this.setupStoragePathSync();
      }

      // Crea le directory necessarie se non esistono
      await this.setupStoragePath();

      // Trova la sessione esistente nel database (creata dal controller)
      const session = await WhatsappSession.findOne({ sessionId });
      if (!session) {
        throw new Error(`Sessione ${sessionId} non trovata nel database`);
      }

      console.log('📋 Sessione trovata nel database, procedo con OpenWA...');

      // 🔑 GESTIONE LICENZE PER UTENTE - Recupera i dati dell'utente per determinare la licenza
      let licenseKey = process.env.OPENWA_LICENSE_KEY; // Licenza di fallback
      
      try {
        const { default: User } = await import('../models/userModel.js');
        const user = await User.findById(owner);
        
        if (user) {
          console.log(`👤 Utente trovato: ${user.firstName} ${user.lastName} (${user.email})`);
          
          // Determina la licenza basandosi sull'email dell'utente
          if (user.email === 'marco@menuchat.com') {
            // Marco Benvenuti usa la licenza esistente (quella già configurata)
            licenseKey = process.env.OPENWA_LICENSE_KEY;
            console.log('🔑 Marco Benvenuti: usando licenza esistente');
          } else if (user.email === 'federico@menuchat.com') {
            // Federico Desantis usa la nuova licenza
            licenseKey = '38E12BAB-83DE4201-9C8473A6-D094A67B';
            console.log('🔑 Federico Desantis: usando licenza specifica');
          } else {
            // Altri utenti usano la licenza di default
            console.log(`🔑 Utente ${user.email}: usando licenza di default`);
          }
          
          console.log(`🎯 Licenza selezionata per ${user.firstName}: ${licenseKey ? licenseKey.substring(0, 8) + '...' : 'Nessuna'}`);
        } else {
          console.warn(`⚠️ Utente non trovato per ID: ${owner}, usando licenza di default`);
        }
      } catch (userError) {
        console.error('❌ Errore nel recupero dati utente:', userError);
        console.log('🔄 Fallback: usando licenza di default');
      }

      // CRITICAL FIX: Forza il percorso di storage per node-persist
      const storagePathForSession = process.env.OPENWA_SESSION_DATA_PATH || path.join(os.tmpdir(), 'wa-storage');
      
      console.log(`📍 CRITICAL CONFIG: sessionDataPath = ${storagePathForSession}`);

      // EXTREME FIX: Cambia working directory temporaneamente
      const originalCwd = process.cwd();
      console.log(`🔄 EXTREME FIX: Cambio working directory da ${originalCwd} a ${storagePathForSession}`);
      
      try {
        process.chdir(storagePathForSession);
        console.log(`✅ EXTREME FIX: Working directory cambiata a ${process.cwd()}`);
      } catch (error) {
        console.warn(`⚠️ EXTREME FIX: Errore cambio directory: ${error.message}`);
      }

      // Configurazione OpenWA ottimizzata basata sulla documentazione
      const config = {
        sessionId,
        headless: process.env.OPENWA_HEADLESS === 'true' || true,
        autoRefresh: true,
        qrTimeout: 120,  // Aumentato per Railway
        authTimeout: 120,  // Aumentato per Railway
        cacheEnabled: false,
        hostNotificationLang: 'IT',
        
        // Fix per timeout su Railway
        waitForRipeSession: 60000,
        
        // CRITICAL FIX: Timeout configurazione basata su documentazione OpenWA
        callTimeout: 300000, // 5 minuti per metodi client OpenWA (deve essere > protocolTimeout)
        protocolTimeout: 180000, // 3 minuti per operazioni Puppeteer
        defaultViewport: null,
        
        chromiumArgs: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
        
        // CRITICAL: Configura esplicitamente sessionDataPath per forzare node-persist
        sessionDataPath: storagePathForSession,
        
        devtools: false,
        
        // Configurazione node-persist per evitare errori di permesso
        disableSpins: true,
        killProcessOnBrowserClose: true,
        
        // Configurazioni aggiuntive per forzare il percorso di storage
        dataPath: storagePathForSession,
        persistDataDir: path.join(storagePathForSession, 'node-persist'),
        
        // Opzioni per gestire meglio l'ambiente headless
        bypassCSP: true,
        skipBrokenMethodsCheck: true,

        // Chrome configuration: Fix per Railway con Puppeteer compatibility
        ...(process.env.NODE_ENV === 'production' ? {
          // Fix per Railway: usa Chrome installato nel container
          executablePath: process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
          useChrome: true,
          // CRITICAL: Disabilita browserRevision per evitare createBrowserFetcher
          // browserRevision: process.env.OPENWA_BROWSER_REVISION || '737027',
          headless: true,
          cacheEnabled: false,
          // Fix per Puppeteer compatibility
          skipBrokenMethodsCheck: true,
          browserWSEndpoint: false,
          // Disabilita auto-download di Chromium
          autoRefresh: true,
          qrTimeout: 120,
          authTimeout: 120,
          waitForRipeSession: 60000,
          
          // CRITICAL FIX: Timeout specifici per Railway/produzione basati su OpenWA docs
          callTimeout: 360000, // 6 minuti per metodi client in produzione
          protocolTimeout: 240000, // 4 minuti per Puppeteer in produzione
          slowMo: 100, // Rallenta le operazioni per stabilità
          
          chromiumArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        } : 
          (process.env.CHROME_PATH && require('fs').existsSync(process.env.CHROME_PATH)) || 
          (process.env.PUPPETEER_EXECUTABLE_PATH && require('fs').existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) ? {
          executablePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
          useChrome: false
        } : {
          useChrome: true  // In sviluppo, cerca Chrome locale
        }),
        // Configurazione per ambienti headless (rimosso chromiumArgs per multi-device)
        // NOTA: chromiumArgs rimossi perché causano problemi con multi-device secondo OpenWA
        // Aggiungi la licenza specifica per l'utente
        ...(licenseKey && { 
          licenseKey: licenseKey 
        }),
        ...session.config
      };

      // Crea la sessione OpenWA
      const client = await create(config);
      
      // EXTREME FIX: Ripristina working directory originale
      try {
        process.chdir(originalCwd);
        console.log(`🔄 EXTREME FIX: Working directory ripristinata a ${process.cwd()}`);
      } catch (error) {
        console.warn(`⚠️ EXTREME FIX: Errore ripristino directory: ${error.message}`);
      }
      
      // Salva il client nella mappa
      this.sessions.set(sessionId, client);
      
      // Setup listener per messaggi
      this.setupMessageListeners(client, sessionId);
      
      console.log(`✅ Sessione creata: ${sessionId} - Licenza: ${licenseKey ? 'Licenza specifica utente' : 'Nessuna licenza'}`);
      return session;

    } catch (error) {
      console.error(`❌ Errore creazione sessione ${sessionId}:`, error);
      
      // EXTREME FIX: Ripristina working directory anche in caso di errore
      try {
        if (typeof originalCwd !== 'undefined') {
          process.chdir(originalCwd);
          console.log(`🔄 EXTREME FIX: Working directory ripristinata dopo errore a ${process.cwd()}`);
        }
      } catch (chdirError) {
        console.warn(`⚠️ EXTREME FIX: Errore ripristino directory dopo errore: ${chdirError.message}`);
      }
      
      // Gestione specifica per errori di timeout Puppeteer
      let errorMessage = 'Errore generico nella creazione sessione';
      if (error.message && error.message.includes('protocolTimeout')) {
        errorMessage = 'Timeout comunicazione browser - sessione potrebbe essere ancora attiva';
        console.warn(`⚠️ Timeout Puppeteer per ${sessionId} - la sessione potrebbe essere comunque attiva`);
      } else if (error.message && error.message.includes('Target closed')) {
        errorMessage = 'Browser chiuso inaspettatamente';
      }
      
      // Aggiorna lo stato in caso di errore
      await WhatsappSession.findOneAndUpdate(
        { sessionId },
        { 
          status: 'error', 
          lastActivity: new Date(),
          // Aggiungi informazioni sull'errore
          eventLogs: {
            $push: {
              event: 'error',
              data: {
                error: errorMessage,
                timestamp: new Date()
              }
            }
          }
        }
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
   * Aggiorna statistiche risposte per le campagne (include tracking per sequenze)
   */
  async updateCampaignReplies(sessionId, contactId) {
    try {
      const campaigns = await WhatsappCampaign.find({
        whatsappSessionId: sessionId,
        status: 'running',
        'messageQueue.contactId': contactId
      });

      for (const campaign of campaigns) {
        // Aggiorna le statistiche generali
        campaign.stats.repliesReceived += 1;
        
        // NUOVO: Marca la risposta ricevuta per questo contatto (disabilita follow-up condizionali)
        campaign.markResponseReceived(contactId);
        
        console.log(`💬 Risposta ricevuta da contatto ${contactId} - follow-up condizionali disabilitati`);
        
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
   * Ottiene lo stato di una sessione (stato reale OpenWA + database)
   */
  async getSessionStatus(sessionId) {
    try {
      const session = await WhatsappSession.findOne({ sessionId });
      if (!session) {
        return { status: 'not_found' };
      }

      const client = this.sessions.get(sessionId);
      const isClientActive = client ? await client.isConnected() : false;
      
      // NUOVO: Ottieni informazioni reali dal client OpenWA
      let realPhoneNumber = session.phoneNumber;
      let realStatus = session.status;
      
      if (client && isClientActive) {
        try {
          // Ottieni il numero reale da OpenWA
          const hostNumber = await client.getHostNumber();
          if (hostNumber && hostNumber !== 'In attesa di connessione...') {
            realPhoneNumber = hostNumber;
            realStatus = 'connected'; // Se ha numero e client attivo = connected
          }
        } catch (error) {
          console.warn(`⚠️ Errore ottenimento hostNumber per ${sessionId}:`, error.message);
        }
      }

      return {
        ...session.toObject(),
        clientConnected: isClientActive,
        phoneNumber: realPhoneNumber, // Numero reale da OpenWA
        status: realStatus, // Stato reale calcolato
        realStatus: realStatus // Stato reale esplicito
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
          
          // CRITICAL FIX: Forza il percorso di storage per riconnessione
          const storagePathForReconnect = process.env.OPENWA_SESSION_DATA_PATH || path.join(os.tmpdir(), 'wa-storage');
          
          const config = {
            sessionId: session.sessionId,
            headless: process.env.OPENWA_HEADLESS === 'true' || true,
            autoRefresh: true,
            sessionDataPath: storagePathForReconnect,
            disableSpins: true,
            killProcessOnBrowserClose: true,
            
            // Fix per timeout durante riconnessione basato su OpenWA docs
            callTimeout: 300000, // 5 minuti per metodi client durante riconnessione
            protocolTimeout: 180000, // 3 minuti per Puppeteer durante riconnessione
            qrTimeout: 120,
            authTimeout: 120,
            waitForRipeSession: 60000,
            chromiumArgs: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-gpu'
            ],

            // Chrome configuration: Fix per Railway con Puppeteer compatibility
            ...(process.env.NODE_ENV === 'production' ? {
              // Fix per Railway: usa Chrome installato nel container
              executablePath: process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
              useChrome: true,
              // CRITICAL: Disabilita browserRevision per evitare createBrowserFetcher
              // browserRevision: process.env.OPENWA_BROWSER_REVISION || '737027',
              headless: true,
              cacheEnabled: false,
              // Fix per Puppeteer compatibility
              skipBrokenMethodsCheck: true,
              browserWSEndpoint: false,
              // Disabilita auto-download di Chromium
              autoRefresh: false,
              qrTimeout: 60,
              authTimeout: 60
            } : 
              (process.env.CHROME_PATH && require('fs').existsSync(process.env.CHROME_PATH)) || 
              (process.env.PUPPETEER_EXECUTABLE_PATH && require('fs').existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) ? {
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
   * Avvia il processore smart delle campagne
   */
  startSmartCampaignProcessor() {
    // Controlla ogni 30 secondi per campagne da eseguire
    setInterval(async () => {
      try {
        await this.processSmartCampaigns();
      } catch (error) {
        console.error('❌ Errore processore smart campagne:', error);
      }
    }, 30000);

    console.log('📧 Smart Campaign Processor avviato con Redis + Rate Limiting');
  }

  /**
   * Processa le campagne attive con sistema smart
   */
  async processSmartCampaigns() {
    try {
      // Trova campagne programmate da avviare
      const scheduledCampaigns = await WhatsappCampaign.findScheduledToRun();
      for (const campaign of scheduledCampaigns) {
        await this.startCampaign(campaign._id);
      }

      // Processa campagne in esecuzione con smart rate limiting
      const runningCampaigns = await WhatsappCampaign.find({ status: 'running' });
      for (const campaign of runningCampaigns) {
        await this.processSmartCampaignMessages(campaign);
      }

    } catch (error) {
      console.error('❌ Errore processamento smart campagne:', error);
    }
  }

  /**
   * Processa messaggi di una campagna con smart rate limiting e locking
   */
  async processSmartCampaignMessages(campaign) {
    try {
      // Ottieni priorità campagna (default media se non specificata)
      const priority = campaign.priority || 'media';
      const config = smartRateLimiter.getConfigForPriority(priority);
      
      // ✅ Statistiche campagna per monitoring
      const stats = {
        pending: campaign.messageQueue.filter(m => m.status === 'pending').length,
        sent: campaign.messageQueue.filter(m => m.status === 'sent').length,
        delivered: campaign.messageQueue.filter(m => m.status === 'delivered').length,
        read: campaign.messageQueue.filter(m => m.status === 'read').length,
        failed: campaign.messageQueue.filter(m => m.status === 'failed').length,
        total: campaign.messageQueue.length
      };
      
      // Calcola quanti failed sono per "Number not linked"
      const noWhatsAppCount = campaign.messageQueue.filter(m => 
        m.status === 'failed' && 
        m.errorMessage && 
        m.errorMessage.includes('Number not linked to WhatsApp Account')
      ).length;
      
      console.log(`📊 Campaign "${campaign.name}": ${stats.pending} pending, ${stats.sent} sent, ${stats.failed} failed (${noWhatsAppCount} no WhatsApp)`);
      
      // Ottieni messaggi da inviare con batch size intelligente
      const pendingMessages = campaign.getNextMessages(config.batchSize);
      
      if (pendingMessages.length === 0) {
        // Verifica se la campagna è completata
        const allProcessed = campaign.messageQueue.every(m => 
          ['sent', 'delivered', 'read', 'failed', 'replied', 'not_interested'].includes(m.status)
        );
        
        if (allProcessed) {
          campaign.status = 'completed';
          campaign.completedAt = new Date();
          await campaign.save();
          console.log(`✅ Campagna completata: ${campaign.name}`);
        }
        
        return;
      }

      // Controlla fascia oraria di invio
      if (!campaign.isInAllowedTimeframe()) {
        console.log(`⏰ Fuori fascia oraria per campagna: ${campaign.name}`);
        return;
      }

      // Verifica rate limiting globale per la sessione
      const rateLimitCheck = await smartRateLimiter.canSendMessage(
        campaign.whatsappSessionId, 
        priority
      );

      if (!rateLimitCheck.allowed) {
        console.log(`🚫 Rate limit: ${rateLimitCheck.reason} - campagna: ${campaign.name}`);
        return;
      }

      console.log(`📊 Processing ${pendingMessages.length} messages for campaign: ${campaign.name} (priority: ${priority})`);

      // Invia messaggi con locking per prevenire duplicati
      let messagesSentInBatch = 0;
      
      for (const messageData of pendingMessages) {
        try {
          // Verifica rate limit prima di ogni messaggio
          const currentRateCheck = await smartRateLimiter.canSendMessage(
            campaign.whatsappSessionId, 
            priority
          );

          if (!currentRateCheck.allowed) {
            console.log(`⏳ Rate limit raggiunto dopo ${messagesSentInBatch} messaggi`);
            break;
          }

          // Usa message locking per prevenire duplicati
          const result = await messageLockingService.withLock(
            campaign._id.toString(),
            messageData.contactId.toString(),
            messageData.sequenceIndex,
            async () => {
              return await this.sendSmartCampaignMessage(campaign, messageData, priority);
            }
          );

          if (result) {
            // Se il messaggio è fallito per "Number not linked", non contarlo come inviato
            if (result.failed && result.reason === 'Number not linked to WhatsApp Account') {
              console.log(`📵 Skipped message to ${result.contact} - no WhatsApp account`);
              // Non incrementare messagesSentInBatch
              // Non attendere intervallo (non ha consumato quota)
            } else {
              // Messaggio inviato con successo
              messagesSentInBatch++;
              
              // Attendi l'intervallo configurato per la priorità
              if (messagesSentInBatch < pendingMessages.length) {
                console.log(`⏱️ Waiting ${config.intervalSeconds}s before next message...`);
                await this.sleep(config.intervalSeconds * 1000);
              }
            }
          }
          
        } catch (error) {
          console.error(`❌ Errore invio messaggio smart:`, error);
          campaign.markMessageFailed(messageData.contactId, error.message);
        }
      }

      // Salva aggiornamenti campagna
      if (messagesSentInBatch > 0) {
        await campaign.save();
        console.log(`📤 Successfully sent ${messagesSentInBatch} messages for campaign: ${campaign.name}`);
      } else {
        // Salva comunque se ci sono stati cambi di status (es. failed)
        const processedMessages = pendingMessages.length;
        if (processedMessages > 0) {
          await campaign.save();
          console.log(`🔄 Processed ${processedMessages} messages for campaign: ${campaign.name} (0 sent, ${processedMessages} failed/skipped)`);
        }
      }

    } catch (error) {
      console.error('❌ Errore processamento smart messaggi campagna:', error);
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

      console.log(`✅ Campagna completata: ${campaign.name}`);

    } catch (error) {
      console.error(`Errore avvio campagna ${campaignId}:`, error);
    }
  }

  /**
   * Processa i messaggi di una campagna (metodo legacy)
   */
  async processCampaignMessages(campaign) {
    try {
      // Ottieni messaggi da inviare
      const pendingMessages = campaign.getNextMessages(5); // Massimo 5 alla volta
      
      if (pendingMessages.length === 0) {
        // Verifica se la campagna è completata
        const allProcessed = campaign.messageQueue.every(m => 
          ['sent', 'delivered', 'read', 'failed', 'replied', 'not_interested'].includes(m.status)
        );
        
        if (allProcessed) {
          campaign.status = 'completed';
          campaign.completedAt = new Date();
          await campaign.save();
          console.log(`✅ Campagna completata: ${campaign.name}`);
        }
        
        return;
      }

      // Controlla fascia oraria di invio (la logica è nel modello)
      if (!campaign.isInAllowedTimeframe()) {
        console.log(`⏰ Fuori fascia oraria per campagna: ${campaign.name}`);
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
   * Invia un singolo messaggio di campagna con smart rate limiting
   */
  async sendSmartCampaignMessage(campaign, messageData, priority = 'media') {
    try {
      const contact = await Contact.findById(messageData.contactId);
      if (!contact || !contact.phone) {
        throw new Error('Contatto non valido o senza numero');
      }

      // Ricontrolla che il messaggio non sia già stato inviato (double-check dopo lock)
      const currentMessage = campaign.messageQueue.find(m => 
        m.contactId.toString() === messageData.contactId.toString() &&
        m.sequenceIndex === messageData.sequenceIndex
      );

      if (!currentMessage || currentMessage.status !== 'pending') {
        console.log(`⏭️ Message already processed for ${contact.name} (sequence: ${messageData.sequenceIndex})`);
        return null;
      }

      // Invia il messaggio via OpenWA
      const messageId = await this.sendMessage(
        campaign.whatsappSessionId,
        contact.phone,
        messageData.compiledMessage,
        campaign.attachments
      );

      // ✅ FIX: Gestisce errore "Number not linked to WhatsApp Account"
      if (messageId && typeof messageId === 'string' && messageId.includes('Number not linked to WhatsApp Account')) {
        console.warn(`📵 ${contact.name} - Number not linked to WhatsApp Account`);
        
        // Marca come FAILED invece di SENT
        campaign.markMessageFailed(messageData.contactId, messageId, messageData.sequenceIndex);
        
        // NON programmare follow-up se il messaggio principale è fallito
        // NON registrare nel rate limiter (non ha consumato quota reale)
        
        return {
          failed: true,
          reason: 'Number not linked to WhatsApp Account',
          contact: contact.name,
          sequenceIndex: messageData.sequenceIndex
        };
      }

      // Aggiorna stato messaggio IMMEDIATAMENTE solo se successo
      await campaign.markMessageSent(messageData.contactId, messageId, messageData.sequenceIndex);

      // Registra nel rate limiter
      await smartRateLimiter.recordMessage(campaign.whatsappSessionId, priority);

      // Se è un messaggio principale (sequenceIndex = 0), programma i follow-up
      if (messageData.sequenceIndex === 0 && campaign.messageSequences && campaign.messageSequences.length > 0) {
        await campaign.scheduleFollowUps(messageData.contactId, contact.phone);
        console.log(`📅 Follow-up programmati per ${contact.name} (${campaign.messageSequences.length} sequenze)`);
      }

      // Crea activity log
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
          sessionId: campaign.whatsappSessionId,
          priority: priority,
          sequenceIndex: messageData.sequenceIndex
        },
        createdBy: campaign.owner
      });
      await activity.save();

      console.log(`📧 Smart message sent to ${contact.name} (priority: ${priority}, sequence: ${messageData.sequenceIndex})`);
      
      return {
        messageId,
        contact: contact.name,
        priority,
        sequenceIndex: messageData.sequenceIndex
      };

    } catch (error) {
      console.error('❌ Errore invio smart messaggio campagna:', error);
      throw error;
    }
  }

  /**
   * Invia un singolo messaggio di campagna (metodo legacy per backward compatibility)
   */
  async sendCampaignMessage(campaign, messageData) {
    // Wrapper per backward compatibility - usa il metodo smart
    return await this.sendSmartCampaignMessage(campaign, messageData, 'media');
  }

  /**
   * Utility per attendere
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Avvia il monitor delle sessioni
   */
  startSessionMonitor() {
    // Importa dinamicamente per evitare dipendenze circolari
    import('./sessionMonitorService.js').then(({ default: sessionMonitorService }) => {
      sessionMonitorService.start();
      console.log('📡 Monitor sessioni avviato');
    }).catch(error => {
      console.error('❌ Errore avvio monitor sessioni:', error);
    });
  }

  /**
   * Cleanup del servizio
   */
  async cleanup() {
    console.log('🧹 Cleanup WhatsApp Service...');
    
    // Ferma il monitor delle sessioni
    try {
      const { default: sessionMonitorService } = await import('./sessionMonitorService.js');
      sessionMonitorService.stop();
    } catch (error) {
      console.error('❌ Errore stop monitor sessioni:', error);
    }
    
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