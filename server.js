import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import contactRoutes from './routes/contactRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import callRoutes from './routes/callRoutes.js';
import inboundLeadRoutes from './routes/inboundLeadRoutes.js';
import voiceFileRoutes from './routes/voiceFileRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import { statusCallback, recordingStatusCallback, testWebhook, answerCall, dialComplete, getRecordingProxy } from './controllers/callController.js';

// Carica le variabili d'ambiente
dotenv.config();

import path from 'path';
import os from 'os';
import fsModule from 'fs';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * SERVER PRINCIPALE PER MENUCHAT CRM
 * Backend Node.js con Express e MongoDB per gestione contatti
 * Include importazione CSV con mappatura dinamica delle colonne
 */

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * CONFIGURAZIONE DATABASE MONGODB
 */
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';

// Connessione a MongoDB con Mongoose
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connesso a MongoDB:', MONGODB_URI);
})
.catch((error) => {
  console.error('❌ Errore connessione MongoDB:', error);
  process.exit(1);
});

// Eventi di connessione MongoDB
mongoose.connection.on('connected', async () => {
  console.log('🔗 Mongoose connesso a MongoDB');
  
  // Migrazione automatica: Fix indice email per permettere valori null multipli
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('contacts');
    
    // Verifica se esiste la collection contacts
    const collections = await db.listCollections({ name: 'contacts' }).toArray();
    if (collections.length > 0) {
      console.log('🔧 Verifica migrazione indice email...');
      
      const existingIndexes = await collection.indexes();
      const emailIndex = existingIndexes.find(idx => 
        idx.key && idx.key.email === 1
      );
      
      if (emailIndex && !emailIndex.sparse) {
        console.log('📧 Migrazione indice email: rimozione indice non-sparse...');
        await collection.dropIndex(emailIndex.name);
        
        console.log('📧 Migrazione indice email: creazione indice sparse...');
        await collection.createIndex(
          { email: 1 }, 
          { 
            unique: true, 
            sparse: true,
            name: 'email_1_sparse'
          }
        );
        console.log('✅ Migrazione indice email completata: ora i contatti senza email sono supportati');
      } else if (!emailIndex) {
        console.log('📧 Creazione indice email sparse...');
        await collection.createIndex(
          { email: 1 }, 
          { 
            unique: true, 
            sparse: true,
            name: 'email_1_sparse'
          }
        );
        console.log('✅ Indice email sparse creato');
      } else {
        console.log('✅ Indice email già configurato correttamente');
      }
    }
  } catch (error) {
    console.warn('⚠️  Avviso migrazione indice email:', error.message);
    // Non blocchiamo l'avvio del server per questo
  }
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Errore connessione Mongoose:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('📡 Mongoose disconnesso da MongoDB');
});

/**
 * MIDDLEWARE GLOBALI
 */

// Stripe webhook (raw body required for signature verification) — BEFORE json parser
import stripeController from './controllers/stripeController.js';
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

// Parsing JSON e URL-encoded
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cookie parser per gestione JWT
app.use(cookieParser());

// Endpoint pubblico audio
import { serveVoiceFile } from './controllers/voiceFileController.js';
app.get('/api/voice-files/:id/audio', serveVoiceFile);

// CORS per permettere richieste dal frontend
app.use(cors({
  origin: function (origin, callback) {
    // Lista domini permessi
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'https://crm-frontend-pied-sigma.vercel.app', // ✅ Frontend Vercel esplicito
      process.env.FRONTEND_URL
    ].filter(Boolean); // Rimuovi valori null/undefined
    
    console.log(`🌐 CORS Check - Origin: ${origin}, Allowed: ${allowedOrigins.join(', ')}`);
    
    // Permetti tutti i domini Vercel se non è specificato FRONTEND_URL
    if (!origin || 
        allowedOrigins.includes(origin) ||
        origin.includes('.vercel.app') ||
        origin.includes('crm-frontend')) {
      console.log(`✅ CORS Allow: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ CORS Deny: ${origin}`);
      callback(new Error('Non permesso da CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Logging delle richieste (solo in development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Crea la cartella uploads se non esiste (per i file CSV)
// In produzione usa la directory temporanea per evitare problemi di permessi
const uploadsDir = isProduction 
  ? path.join(os.tmpdir(), 'uploads')
  : './uploads';
  
if (!fsModule.existsSync(uploadsDir)) {
  fsModule.mkdirSync(uploadsDir, { recursive: true });
  console.log(`📁 Cartella uploads creata: ${uploadsDir}`);
}

// Imposta la variabile d'ambiente per multer
process.env.UPLOADS_DIR = uploadsDir;

/**
 * ROUTES PRINCIPALI
 */

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'MenuChatCRM Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      contacts: '/api/contacts',
      health: '/health',
      docs: '/api-docs'
    }
  });
});

// Health check dettagliato
app.get('/health', async (req, res) => {
  try {
    // Controlla la connessione al database
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    const commitHash = process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown';
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      commitHash,
      uptimeSeconds: Math.round(process.uptime()),
      services: {
        database: {
          status: dbStatus,
          uri: MONGODB_URI.replace(/\/\/.*@/, '//***:***@') // Nasconde le credenziali
        },
        server: {
          status: 'running',
          port: PORT,
          environment: process.env.NODE_ENV || 'development'
        }
      },
      features: [
        'CRUD operations sui contatti',
        'Gestione liste dinamiche',
        'Importazione CSV con mappatura colonne',
        'Proprietà dinamiche sui contatti',
        'Validazione email e telefono',
        'Paginazione e ricerca',
        'Statistiche contatti'
      ]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * WEBHOOK ROUTES PUBBLICHE (PRIMA DI TUTTO - SENZA AUTENTICAZIONE)
 */

// Webhook per lead inbound da MenuChat - PUBBLICO
app.use('/api/inbound', inboundLeadRoutes);

// Webhook inbound WhatsApp da Twilio (PUBBLICO)
import { twilioWhatsAppInbound } from './controllers/twilioWhatsAppWebhookController.js';
app.post('/api/webhooks/twilio-whatsapp', twilioWhatsAppInbound);

// Endpoint pubblico per approvazione bozze agente via email (URL firmati HMAC)
import { verifySignedUrl, renderHtmlPage, buildFeedbackContext, getISOWeek } from './services/signedUrlService.js';
import AgentFeedback from './models/agentFeedbackModel.js';
import { approveAndSend, discardReply } from './services/salesAgentService.js';
import { sendFeedbackToAgent } from './services/agentServiceClient.js';
import Contact from './models/contactModel.js';
import Conversation from './models/conversationModel.js';

app.get('/api/agent/email-action', async (req, res) => {
  try {
    const { id, action, exp, token } = req.query;

    if (!id || !action || !exp || !token || !verifySignedUrl(id, action, exp, token)) {
      return res.status(403).send(renderHtmlPage(
        'Link scaduto o non valido',
        'Questo link non è valido o è scaduto. Apri la conversazione nel CRM.',
        '#ef4444'
      ));
    }

    const conversation = await Conversation.findById(id);
    if (!conversation || conversation.status !== 'awaiting_human') {
      return res.status(404).send(renderHtmlPage(
        'Già gestita',
        'Questa conversazione è già stata gestita o non esiste più.',
        '#f59e0b'
      ));
    }

    const agentDraft = conversation.messages.filter(m => m.role === 'agent').pop()?.content;

    if (action === 'approve') {
      await approveAndSend(id);
      await AgentFeedback.create({
        conversation: id,
        contact: conversation.contact,
        agentDraft: agentDraft || '',
        finalSent: agentDraft,
        action: 'approved',
        conversationContext: buildFeedbackContext(conversation),
        weekNumber: getISOWeek(new Date())
      });

      const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);
      sendFeedbackToAgent({
        conversation, contact: contactDoc,
        agentDraft: agentDraft || '', action: 'approved',
      }).catch(() => {});

      return res.send(renderHtmlPage(
        'Messaggio inviato!',
        'La risposta dell\'agente è stata approvata e inviata al lead.',
        '#10b981'
      ));
    }

    if (action === 'discard') {
      await discardReply(id);
      await AgentFeedback.create({
        conversation: id,
        contact: conversation.contact,
        agentDraft: agentDraft || '',
        action: 'discarded',
        discardReason: 'email_quick_discard',
        conversationContext: buildFeedbackContext(conversation),
        weekNumber: getISOWeek(new Date())
      });

      const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);
      sendFeedbackToAgent({
        conversation, contact: contactDoc,
        agentDraft: agentDraft || '', action: 'discarded',
        discardReason: 'email_quick_discard',
      }).catch(() => {});

      return res.send(renderHtmlPage(
        'Bozza scartata',
        'La bozza è stata scartata. La conversazione è in pausa.',
        '#ef4444'
      ));
    }

    return res.status(400).send(renderHtmlPage('Errore', 'Azione non riconosciuta.', '#6b7280'));
  } catch (error) {
    console.error('❌ Errore email-action:', error);
    return res.status(500).send(renderHtmlPage('Errore', 'Si è verificato un errore. Riprova dal CRM.', '#ef4444'));
  }
});

// Webhook Twilio per stato chiamate - DEVE essere pubblico
app.post('/api/calls/status-callback', statusCallback);
app.get('/api/calls/status-callback', (req, res) => {
  console.log('🔔 GET Webhook ricevuto (non dovrebbe succedere):', req.query);
  res.status(200).send('Webhook GET ricevuto');
});

// Webhook Twilio per registrazioni - DEVE essere pubblico
app.post('/api/calls/recording-status', recordingStatusCallback);

// Test webhook - pubblico
app.get('/api/calls/test-webhook', testWebhook);
app.post('/api/calls/test-webhook', testWebhook);

// Answer endpoint - quando tu rispondi alla chiamata
app.get('/api/calls/answer', answerCall);
app.post('/api/calls/answer', answerCall);

// Dial complete - quando finisce il collegamento
app.post('/api/calls/dial-complete', dialComplete);

// Proxy per registrazioni audio - PUBBLICO (senza autenticazione)
app.get('/api/calls/recording/:recordingSid', getRecordingProxy);

// DEBUG: Endpoint per verificare permessi uploads (SOLO PER DEBUG)
app.get('/debug/uploads', async (req, res) => {
  try {
    const stats = {
      uploadsDir: uploadsDir,
      absolutePath: path.resolve(uploadsDir),
      exists: fsModule.existsSync(uploadsDir),
      environment: process.env.NODE_ENV,
      uploadsEnvVar: process.env.UPLOADS_DIR
    };

    // Test scrittura se la directory esiste
    if (stats.exists) {
      const testFilePath = path.join(uploadsDir, 'test-debug.txt');
      try {
        fsModule.writeFileSync(testFilePath, 'Debug test file');
        stats.canWrite = true;
        fsModule.unlinkSync(testFilePath);
        stats.canDelete = true;
      } catch (writeError) {
        stats.canWrite = false;
        stats.writeError = {
          message: writeError.message,
          code: writeError.code
        };
      }

      // Informazioni sui permessi
      try {
        const dirStats = fsModule.statSync(uploadsDir);
        stats.permissions = {
          mode: dirStats.mode.toString(8),
          created: dirStats.birthtime,
          modified: dirStats.mtime
        };
        
        if (process.platform !== 'win32') {
          stats.permissions.canRead = !!(dirStats.mode & parseInt('400', 8));
          stats.permissions.canWrite = !!(dirStats.mode & parseInt('200', 8));
          stats.permissions.canExecute = !!(dirStats.mode & parseInt('100', 8));
        }
      } catch (permError) {
        stats.permissionsError = permError.message;
      }
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// Internal routes (agent-to-CRM, no auth) — MUST be before activityRoutes which applies protect to /api/*
import internalRoutes from './routes/internalRoutes.js';
app.use('/api/internal', internalRoutes);

// Routes per autenticazione
app.use('/api/auth', authRoutes);

// Routes per gestione utenti
app.use('/api/users', userRoutes);

// Routes per il cruscotto (sotto /api/dashboard)
app.use('/api/dashboard', dashboardRoutes);

// Routes per Stripe (sotto /api/stripe)
import stripeRoutes from './routes/stripeRoutes.js';
app.use('/api/stripe', stripeRoutes);

// Routes per SaaS Metrics (sotto /api/saas-metrics)
import saasMetricsRoutes from './routes/saasMetricsRoutes.js';
app.use('/api/saas-metrics', saasMetricsRoutes);

// Routes per i contatti (tutte le API sotto /api/contacts)
app.use('/api/contacts', contactRoutes);

// Routes per le activities (sotto /api)
app.use('/api', activityRoutes);

// Routes per le chiamate (sotto /api/calls)
app.use('/api/calls', callRoutes);

// Routes per voice files (sotto /api/voice-files)
app.use('/api/voice-files', voiceFileRoutes);

// Routes per l'AI Sales Agent
import agentRoutes from './routes/agentRoutes.js';
app.use('/api/agent', agentRoutes);

// Routes per Agent Task System
import agentTaskRoutes from './routes/agentTaskRoutes.js';
app.use('/api/agent', agentTaskRoutes);


// Agent Task System: Task Processor + Task Generator (sostituisce vecchi setInterval)
import { startTaskProcessor, startTaskGenerator } from './services/taskProcessorService.js';
import { checkAgentHealth } from './services/agentServiceClient.js';

setTimeout(async () => {
  const agentOnline = await checkAgentHealth();
  if (agentOnline) {
    console.log('✅ Agent Service raggiungibile');
  } else {
    console.warn('⚠️ Agent Service NON raggiungibile — i task verranno accodati ma non processati');
  }

  if (process.env.ENABLE_AGENT_OUTREACH === 'true') {
    startTaskProcessor();
    startTaskGenerator();
  } else {
    console.log('ℹ️ Agent task system disabilitato (ENABLE_AGENT_OUTREACH != true)');
  }

  // Sales Manager Agent: daily at 7 AM Rome time
  const SM_CHECK_INTERVAL_MS = 15 * 60 * 1000; // check every 15min
  let smLastRunDate = null;
  const runSalesManagerDaily = async () => {
    const now = new Date();
    const romeTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    const romeH = romeTime.getHours();
    const todayStr = romeTime.toISOString().slice(0, 10);

    if (romeH >= 7 && smLastRunDate !== todayStr) {
      smLastRunDate = todayStr;
      try {
        const { runSalesManagerCycle } = await import('./services/salesManagerService.js');
        const result = await runSalesManagerCycle();
        if (result) {
          console.log(`[Sales Manager] Ciclo giornaliero completato: ${result.directives?.length || 0} directives, ${result.alerts?.length || 0} alerts, ${result.tool_calls_made || 0} tool calls`);
        }
      } catch (err) {
        console.error('[Sales Manager] Errore:', err.message);
      }
    }
  };
  setTimeout(runSalesManagerDaily, 30000);
  setInterval(runSalesManagerDaily, SM_CHECK_INTERVAL_MS);
  console.log('[Sales Manager] Schedulato giornaliero alle 7:00 Roma');
}, 10000);

// Endpoint per la documentazione delle API
app.get('/api-docs', (req, res) => {
  res.json({
    title: 'MenuChatCRM API Documentation',
    version: '1.0.0',
    description: 'API REST per la gestione di contatti con importazione CSV e proprietà dinamiche',
    endpoints: {
      'POST /api/contacts': {
        description: 'Crea un nuovo contatto',
        body: {
          name: 'string (required)',
          email: 'string (required, unique)',
          phone: 'string (optional)',
          lists: 'array of strings (optional)',
          properties: 'object (optional)'
        }
      },
      'GET /api/contacts': {
        description: 'Lista contatti con filtri opzionali',
        queryParams: {
          list: 'string - filtra per lista',
          page: 'number - pagina (default: 1)',
          limit: 'number - contatti per pagina (default: 10)',
          search: 'string - ricerca per nome o email'
        }
      },
      'GET /api/contacts/:id': {
        description: 'Ottieni contatto per ID'
      },
      'PUT /api/contacts/:id': {
        description: 'Aggiorna contatto esistente'
      },
      'DELETE /api/contacts/:id': {
        description: 'Elimina contatto'
      },
      'DELETE /api/contacts/bulk': {
        description: 'Elimina contatti multipli (fino a 10,000)',
        body: {
          contactIds: 'array of strings (contact IDs)'
        }
      },
      'DELETE /api/contacts/delete-all': {
        description: 'Elimina TUTTI i contatti (solo manager/admin)',
        body: {
          confirmText: 'string (deve essere "DELETE ALL CONTACTS")',
          onlyMyContacts: 'boolean (opzionale, solo per manager/admin)'
        }
      },
      'POST /api/contacts/lists/:listName/contacts/:id': {
        description: 'Aggiunge contatto a lista'
      },
      'DELETE /api/contacts/lists/:listName/contacts/:id': {
        description: 'Rimuove contatto da lista'
      },
      'POST /api/contacts/import-csv?phase=analyze': {
        description: 'Analizza file CSV e mostra colonne disponibili',
        contentType: 'multipart/form-data',
        body: {
          csvFile: 'file (CSV format)'
        }
      },
      'POST /api/contacts/import-csv?phase=import': {
        description: 'Importa contatti da CSV con mappatura',
        contentType: 'multipart/form-data',
        body: {
          csvFile: 'file (CSV format)',
          mapping: 'JSON object (column mapping)',
          duplicateStrategy: 'string (skip|update)'
        }
      },
      'GET /api/contacts/stats': {
        description: 'Statistiche sui contatti'
      },
      'GET /api/contacts/dynamic-properties': {
        description: 'Lista delle proprietà dinamiche esistenti'
      },
      'GET /api/contacts/csv-mapping-options': {
        description: 'Opzioni complete per la mappatura CSV con proprietà esistenti'
      }
    },
    examples: {
      createContact: {
        url: 'POST /api/contacts',
        body: {
          name: 'Mario Rossi',
          email: 'mario.rossi@email.com',
          phone: '+39 123 456 7890',
          lists: ['clienti', 'newsletter'],
          properties: {
            company: 'Acme Corp',
            notes: 'Cliente VIP',
            lastContact: '2024-01-15'
          }
        }
      },
      csvMapping: {
        'Nome Completo': 'name',
        'Email': 'email',
        'Telefono': 'phone',
        'Azienda': 'properties.company',
        'Note': 'properties.notes',
        'Colonna Inutile': 'ignore'
      }
    }
  });
});

/**
 * MIDDLEWARE DI GESTIONE ERRORI GLOBALE
 */
app.use((err, req, res, next) => {
  console.error('❌ Errore server:', err);

  // Errori di validazione Mongoose
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Errore di validazione',
      errors
    });
  }

  // Errori di duplicato (email già esistente)
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Email già esistente nel database'
    });
  }

  // Errori di cast (ID non valido)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'ID non valido'
    });
  }

  // Errore generico del server
  res.status(500).json({
    success: false,
    message: 'Errore interno del server',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

/**
 * GESTIONE 404 PER ROUTES NON TROVATE
 */
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route non trovata: ${req.method} ${req.originalUrl}`,
    suggestion: 'Controlla la documentazione API su /api-docs'
  });
});

/**
 * AVVIO DEL SERVER
 */
const server = app.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log('🎯 MENUCHAT CRM BACKEND AVVIATO');
  console.log('🚀 ========================================');
  console.log(`📡 Server in ascolto su porta: ${PORT}`);
  console.log(`🌐 URL locale: http://localhost:${PORT}`);
  console.log(`📚 Documentazione API: http://localhost:${PORT}/api-docs`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log('🚀 ========================================');
  
  // Graceful shutdown per Redis
  process.on('SIGINT', async () => {
    console.log('\n🔄 Graceful shutdown initiated...');
    
    try {
      // Importa redisManager per shutdown
      const { default: redisManager } = await import('./config/redis.js');
      await redisManager.disconnect();
    } catch (error) {
      console.error('❌ Error during Redis shutdown:', error.message);
    }
    
    console.log('✅ Shutdown completed');
    process.exit(0);
  });
});

/**
 * GESTIONE CHIUSURA GRACEFUL
 */
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM ricevuto, chiusura graceful del server...');
  server.close(() => {
    console.log('✅ Server chiuso');
    mongoose.connection.close(false, () => {
      console.log('✅ Connessione MongoDB chiusa');
      process.exit(0);
    });
  });
});

export default app; 