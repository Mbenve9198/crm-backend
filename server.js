import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import contactRoutes from './routes/contactRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import callRoutes from './routes/callRoutes.js';
import twilioSettingsRoutes from './routes/twilioSettingsRoutes.js';
import whatsappTemplateRoutes from './routes/whatsappTemplateRoutes.js';
import whatsappSessionRoutes from './routes/whatsappSessionRoutes.js';
import whatsappCampaignRoutes from './routes/whatsappCampaignRoutes.js';
import { statusCallback, recordingStatusCallback, testWebhook, answerCall, dialComplete, getRecordingProxy } from './controllers/callController.js';
import whatsappService from './services/whatsappService.js';
import fixNodePersistPermissions from './scripts/fixNodePersistPermissions.js';

// Carica le variabili d'ambiente
dotenv.config();

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

// Parsing JSON e URL-encoded
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser per gestione JWT
app.use(cookieParser());

// CORS per permettere richieste dal frontend
app.use(cors({
  origin: function (origin, callback) {
    // Lista domini permessi
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      process.env.FRONTEND_URL
    ];
    
    // Permetti tutti i domini Vercel se non è specificato FRONTEND_URL
    if (!origin || 
        allowedOrigins.includes(origin) ||
        origin.includes('.vercel.app') ||
        origin.includes('crm-frontend')) {
      callback(null, true);
    } else {
      callback(new Error('Non permesso da CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging delle richieste (solo in development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Crea la cartella uploads se non esiste (per i file CSV)
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Cartella uploads creata');
}

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
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
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

// DEBUG: Endpoint per verificare installazione Chrome (SOLO PER DEBUG)
app.get('/debug/chrome', async (req, res) => {
  try {
    const { existsSync } = await import('fs');
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    const results = paths.map(path => ({
      path,
      exists: existsSync(path)
    }));
    
    res.json({
      environment: process.env.NODE_ENV,
      chromePath: process.env.CHROME_PATH,
      puppeteerPath: process.env.PUPPETEER_EXECUTABLE_PATH,
      availablePaths: results,
      openwaConfig: {
        headless: process.env.OPENWA_HEADLESS,
        sessionDataPath: process.env.OPENWA_SESSION_DATA_PATH
      },
      deployInfo: {
        lastUpdate: new Date().toISOString(),
        serverStartTime: process.uptime(),
        nodeVersion: process.version
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// Routes per autenticazione
app.use('/api/auth', authRoutes);

// Routes per gestione utenti
app.use('/api/users', userRoutes);

// Routes per i contatti (tutte le API sotto /api/contacts)
app.use('/api/contacts', contactRoutes);

// Routes per le activities (sotto /api)
app.use('/api', activityRoutes);

// Routes per le chiamate (sotto /api/calls)
app.use('/api/calls', callRoutes);

// Routes per le impostazioni Twilio (sotto /api/settings/twilio)
app.use('/api/settings/twilio', twilioSettingsRoutes);

// Routes per i template WhatsApp (sotto /api/settings)
app.use('/api/settings', whatsappTemplateRoutes);

// Routes per le sessioni WhatsApp (sotto /api/whatsapp-sessions)
app.use('/api/whatsapp-sessions', whatsappSessionRoutes);

// Routes per le campagne WhatsApp (sotto /api/whatsapp-campaigns)
app.use('/api/whatsapp-campaigns', whatsappCampaignRoutes);

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
  
  // Fix permessi node-persist per OpenWA (solo in produzione)
  if (process.env.NODE_ENV === 'production') {
    fixNodePersistPermissions().catch(error => {
      console.warn('⚠️ Avviso fix permessi node-persist:', error.message);
    });
  }
  
  // Inizializza il servizio WhatsApp
  whatsappService.initialize().catch(error => {
    console.error('❌ Errore inizializzazione WhatsApp Service:', error);
  });
  
  // Preparazione per futura integrazione Twilio
  console.log('📞 Preparato per integrazione Twilio (funzionalità dialing future)');
});

/**
 * GESTIONE CHIUSURA GRACEFUL
 */
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM ricevuto, chiusura graceful del server...');
  server.close(() => {
    console.log('✅ Server chiuso');
    // Cleanup del servizio WhatsApp
    whatsappService.cleanup().then(() => {
      mongoose.connection.close(false, () => {
        console.log('✅ Connessione MongoDB chiusa');
        process.exit(0);
      });
    });
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT ricevuto, chiusura graceful del server...');
  server.close(() => {
    console.log('✅ Server chiuso');
    // Cleanup del servizio WhatsApp
    whatsappService.cleanup().then(() => {
      mongoose.connection.close(false, () => {
        console.log('✅ Connessione MongoDB chiusa');
        process.exit(0);
      });
    });
  });
});

export default app; 