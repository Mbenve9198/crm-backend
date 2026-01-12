import twilio from 'twilio';
import Call from '../models/callModel.js';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import User from '../models/userModel.js';

/**
 * Controller per la gestione delle chiamate Twilio
 * Usa le credenziali Twilio dalle variabili d'ambiente
 */

// Credenziali Twilio dalle variabili d'ambiente
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

/**
 * Crea client Twilio usando le variabili d'ambiente
 * @returns {Object} - Client Twilio configurato
 */
function createTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Credenziali Twilio non configurate nelle variabili d\'ambiente (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
  }
  
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Inizia una chiamata verso un contatto
 * POST /api/calls/initiate
 */
export const initiateCall = async (req, res) => {
  try {
    const { contactId, recordCall = true } = req.body;
    const userId = req.user.id;

    // Verifica che le credenziali Twilio siano configurate nelle variabili d'ambiente
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return res.status(400).json({
        success: false,
        message: 'Credenziali Twilio non configurate. Contatta l\'amministratore per configurare TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN.'
      });
    }

    // Ottieni l'utente per il numero di telefono Twilio
    const user = await User.findById(userId);
    const twilioPhone = user?.settings?.twilio?.phoneNumber || TWILIO_PHONE_NUMBER;
    
    if (!twilioPhone) {
      return res.status(400).json({
        success: false,
        message: 'Numero di telefono Twilio non configurato. Configura il numero nelle impostazioni.'
      });
    }

    // Crea client Twilio dalle variabili d'ambiente
    const client = createTwilioClient();

    // Verifica che il contatto esista e l'utente possa accedervi
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (!req.user.canAccessContact(contact)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per chiamare questo contatto'
      });
    }

    // Verifica che il contatto abbia un numero di telefono
    if (!contact.phone) {
      return res.status(400).json({
        success: false,
        message: 'Il contatto non ha un numero di telefono'
      });
    }

    // Normalizza il numero di telefono
    const toNumber = contact.phone.replace(/\s/g, '');
    if (!toNumber.startsWith('+')) {
      return res.status(400).json({
        success: false,
        message: 'Il numero di telefono deve essere in formato internazionale (+39...)'
      });
    }

    // URL del webhook per gestire gli eventi della chiamata
    const statusCallbackUrl = `${process.env.BACKEND_URL || 'https://crm-backend-8gwn.onrender.com'}/api/calls/status-callback`;
    const answerUrl = `${process.env.BACKEND_URL || 'https://crm-backend-8gwn.onrender.com'}/api/calls/answer`;
    
    console.log('🌐 BACKEND_URL configurato:', process.env.BACKEND_URL);
    console.log('📡 Status callback URL:', statusCallbackUrl);
    console.log('📞 Answer URL:', answerUrl);
    
    if (!process.env.BACKEND_URL) {
      console.warn('⚠️  BACKEND_URL non configurato! Usando URL di default. Configura la variabile d\'ambiente per Twilio.');
    }

    // Numero Twilio dalle variabili d'ambiente
    const userPhone = TWILIO_PHONE_NUMBER;

    console.log(`📞 Chiamata verso di te: ${userPhone}`);
    console.log(`📞 Poi collegamento al contatto: ${toNumber}`);

    // Inizia la chiamata verso di TE (primo leg)
    // Quando rispondi, Twilio chiamerà answerUrl per sapere cosa fare
    const call = await client.calls.create({
      from: userPhone, // DA il tuo numero
      to: userPhone, // VERSO il tuo numero (Twilio ti chiama!)
      url: answerUrl, // Quando rispondi, Twilio chiama questo URL per il TwiML
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: recordCall, // true o false
      recordingStatusCallback: statusCallbackUrl,
      recordingStatusCallbackEvent: ['completed'],
      timeout: 60
    });

    // Salviamo i dati della chiamata per l'endpoint answer
    const callData = {
      contactPhone: toNumber,
      recordCall,
      callSid: call.sid
    };
    
    // Salviamo temporaneamente i dati (in produzione useresti Redis o simile)
    global.pendingCalls = global.pendingCalls || {};
    global.pendingCalls[call.sid] = callData;

    // Salva la chiamata nel database
    const callRecord = new Call({
      twilioCallSid: call.sid,
      contact: contactId,
      initiatedBy: userId,
      fromNumber: twilioPhone,
      toNumber: toNumber,
      status: call.status,
      direction: 'outbound-api',
      twilioData: {
        dateCreated: call.dateCreated,
        priceUnit: call.priceUnit
      }
    });

    await callRecord.save();

    // Popola i dati per la risposta
    await callRecord.populate([
      { path: 'contact', select: 'name phone' },
      { path: 'initiatedBy', select: 'firstName lastName' }
    ]);

    // Non creare activity ora - sarà creata solo quando si salva l'esito

    res.status(201).json({
      success: true,
      message: 'Chiamata iniziata con successo',
      data: {
        call: callRecord,
        twilioCallSid: call.sid,
        status: call.status
      }
    });

  } catch (error) {
    console.error('Errore nell\'iniziare la chiamata:', error);
    
    // Gestisce errori specifici di Twilio
    if (error.code) {
      return res.status(400).json({
        success: false,
        message: `Errore Twilio: ${error.message}`,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server nell\'iniziare la chiamata'
    });
  }
};

/**
 * Endpoint che restituisce TwiML quando tu rispondi alla chiamata
 * GET/POST /api/calls/answer
 */
export const answerCall = async (req, res) => {
  try {
    const { CallSid } = req.query.CallSid ? req.query : req.body;
    
    console.log('📞 ANSWER CALL - CallSid:', CallSid);
    console.log('📞 Query params:', req.query);
    console.log('📞 Body params:', req.body);
    
    // Recupera i dati della chiamata salvati
    const callData = global.pendingCalls?.[CallSid];
    
    if (!callData) {
      console.error('❌ Dati chiamata non trovati per CallSid:', CallSid);
      return res.status(400).type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice" language="it-IT">Errore nel recuperare i dati della chiamata</Say>
          <Hangup/>
        </Response>
      `);
    }

    const { contactPhone, recordCall } = callData;
    
    console.log(`📞 Collegamento in corso verso: ${contactPhone}`);
    console.log(`🎙️  Registrazione: ${recordCall ? 'attiva' : 'disattiva'}`);

    // Costruisce TwiML per collegarti al contatto
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="it-IT">Collegamento in corso</Say>
  <Dial record="${recordCall ? 'record-from-answer' : 'do-not-record'}" 
        action="${process.env.BACKEND_URL || 'https://crm-backend-8gwn.onrender.com'}/api/calls/dial-complete" 
        method="POST"
        recordingStatusCallback="${process.env.BACKEND_URL || 'https://crm-backend-8gwn.onrender.com'}/api/calls/recording-status">
    <Number>${contactPhone}</Number>
  </Dial>
</Response>`;

    console.log('📋 TwiML generato:', twiml);

    // Pulisci i dati temporanei
    delete global.pendingCalls[CallSid];

    res.type('text/xml').send(twiml);

  } catch (error) {
    console.error('❌ Errore in answerCall:', error);
    res.status(500).type('text/xml').send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice" language="it-IT">Errore del sistema</Say>
        <Hangup/>
      </Response>
    `);
  }
};

/**
 * Webhook chiamato quando il Dial è completato
 * POST /api/calls/dial-complete
 */
export const dialComplete = async (req, res) => {
  try {
    console.log('📞 DIAL COMPLETE ricevuto:', req.body);
    
    // TwiML per terminare la chiamata
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="it-IT">Chiamata terminata</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('❌ Errore in dialComplete:', error);
    res.status(500).type('text/xml').send('<Response><Hangup/></Response>');
  }
};

/**
 * Webhook per aggiornamenti di stato delle chiamate
 * POST /api/calls/status-callback
 */
export const statusCallback = async (req, res) => {
  try {
    console.log('🔔 WEBHOOK RICEVUTO - Status Callback');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', req.headers);
    console.log('Body completo:', req.body);
    
    const {
      CallSid,
      CallStatus,
      CallDuration,
      From,
      To,
      Direction,
      RecordingUrl,
      RecordingSid,
      RecordingDuration
    } = req.body;

    console.log(`📞 Callback stato chiamata: ${CallSid} -> ${CallStatus}`);

    // Trova la chiamata nel database
    const call = await Call.findOne({ twilioCallSid: CallSid });
    if (!call) {
      console.warn(`⚠️  Chiamata non trovata: ${CallSid}`);
      return res.status(404).send('Call not found');
    }

    // Aggiorna lo stato e le informazioni
    await call.updateStatus(CallStatus, {
      duration: CallDuration ? parseInt(CallDuration) : undefined,
      direction: Direction,
      recordingUrl: RecordingUrl,
      recordingSid: RecordingSid,
      recordingDuration: RecordingDuration ? parseInt(RecordingDuration) : undefined
    });

    // Se la chiamata è completata, aggiorna l'attività
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
      const activity = await Activity.findOne({
        'data.twilioCallSid': CallSid
      });

      if (activity) {
        // Aggiorna status dell'attività
        activity.status = 'completed';
        
        // Aggiorna descrizione con l'esito
        activity.description += ` - ${CallStatus.toUpperCase()}`;
        if (CallDuration) {
          activity.description += ` (${Math.floor(CallDuration / 60)}:${(CallDuration % 60).toString().padStart(2, '0')})`;
        }
        
        // Aggiorna i dati con l'esito della chiamata
        activity.data = {
          ...activity.data,
          callOutcome: CallStatus, // Mappa lo stato Twilio all'outcome
          callDuration: CallDuration ? parseInt(CallDuration) : 0,
          finalStatus: CallStatus,
          recordingUrl: RecordingUrl
        };
        
        await activity.save();
      }
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('Errore nel callback di stato:', error);
    res.status(500).send('Error processing callback');
  }
};

/**
 * Webhook per stato delle registrazioni
 * POST /api/calls/recording-status
 */
export const recordingStatusCallback = async (req, res) => {
  try {
    const {
      CallSid,
      RecordingSid,
      RecordingUrl,
      RecordingStatus,
      RecordingDuration
    } = req.body;

    console.log(`🎙️  Callback registrazione: ${RecordingSid} -> ${RecordingStatus}`);

    if (RecordingStatus === 'completed') {
      const call = await Call.findOne({ twilioCallSid: CallSid });
      if (call) {
        await call.addRecording(
          RecordingSid,
          RecordingUrl,
          RecordingDuration ? parseInt(RecordingDuration) : 0
        );
        console.log(`✅ Registrazione salvata per chiamata: ${CallSid}`);
        
        // Aggiorna anche l'Activity correlata se esiste
        const Activity = (await import('../models/activityModel.js')).default;
        const activity = await Activity.findOne({ 
          'data.twilioCallSid': CallSid,
          type: 'call'
        });
        
        if (activity) {
          activity.data.recordingUrl = RecordingUrl;
          activity.data.recordingSid = RecordingSid;
          activity.data.recordingDuration = RecordingDuration ? parseInt(RecordingDuration) : 0;
          await activity.save();
          console.log(`✅ Registrazione aggiunta all'activity: ${activity._id}`);
        }
      }
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('Errore nel callback registrazione:', error);
    res.status(500).send('Error processing recording callback');
  }
};

/**
 * Cancella una chiamata attiva (per sbloccare chiamate bloccate)
 * POST /api/calls/:callId/cancel
 */
export const cancelCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    // Trova la chiamata
    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Chiamata non trovata'
      });
    }

    // Verifica che l'utente possa cancellare questa chiamata
    if (call.initiatedBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non puoi cancellare questa chiamata'
      });
    }

    // Se la chiamata è già terminata, non fare nulla
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(call.status)) {
      return res.json({
        success: true,
        message: 'La chiamata era già terminata',
        data: call
      });
    }

    // Aggiorna lo stato della chiamata
    await call.updateStatus('canceled', { reason: 'Cancellata dall\'utente' });

    // Aggiorna l'attività correlata
    const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
    if (activity) {
      activity.status = 'completed';
      activity.description += ' - CANCELLATA';
      activity.data = {
        ...activity.data,
        callOutcome: 'canceled',
        reason: 'user_canceled'
      };
      await activity.save();
    }

    // Prova a cancellare la chiamata anche su Twilio se possibile
    try {
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        const client = createTwilioClient();
        await client.calls(call.twilioCallSid).update({ status: 'canceled' });
        console.log(`📞 Chiamata cancellata su Twilio: ${call.twilioCallSid}`);
      }
    } catch (twilioError) {
      console.warn(`⚠️ Errore cancellando su Twilio: ${twilioError.message}`);
      // Non bloccare la risposta per errori Twilio
    }

    res.json({
      success: true,
      message: 'Chiamata cancellata con successo',
      data: call
    });

  } catch (error) {
    console.error('Errore nel cancellare la chiamata:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Pulisce le chiamate bloccate più vecchie di X minuti
 * POST /api/calls/cleanup-stuck
 */
export const cleanupStuckCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const { thresholdMinutes = 2, allUsers = false } = req.body;
    
    // Solo admin può pulire le chiamate di tutti gli utenti
    if (allUsers && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Solo gli admin possono pulire le chiamate di tutti gli utenti'
      });
    }

    const thresholdMs = thresholdMinutes * 60 * 1000;
    const cutoffTime = new Date(Date.now() - thresholdMs);
    
    // Costruisci query
    const query = {
      status: { $in: ['queued', 'ringing', 'in-progress'] },
      createdAt: { $lt: cutoffTime }
    };
    
    // Se non è admin, limita alle proprie chiamate
    if (!allUsers) {
      query.initiatedBy = userId;
    }

    const stuckCalls = await Call.find(query).populate('initiatedBy', 'firstName lastName email');
    
    console.log(`🧹 Pulizia ${stuckCalls.length} chiamate bloccate da più di ${thresholdMinutes} minuti`);

    const cleanedCalls = [];
    
    for (const call of stuckCalls) {
      // Aggiorna lo stato della chiamata
      await call.updateStatus('failed', { 
        reason: `API cleanup - chiamata bloccata da più di ${thresholdMinutes} minuti`,
        cleanupTimestamp: new Date(),
        cleanupBy: userId
      });

      // Aggiorna l'attività correlata
      const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
      if (activity) {
        activity.status = 'completed';
        activity.description += ` - CLEANUP (${thresholdMinutes}min timeout)`;
        activity.data = {
          ...activity.data,
          callOutcome: 'failed',
          reason: 'api_cleanup_stuck'
        };
        await activity.save();
      }
      
      cleanedCalls.push({
        twilioCallSid: call.twilioCallSid,
        status: call.status,
        user: call.initiatedBy ? `${call.initiatedBy.firstName} ${call.initiatedBy.lastName}` : 'Unknown',
        createdAt: call.createdAt
      });
    }

    res.json({
      success: true,
      message: `Pulite ${cleanedCalls.length} chiamate bloccate`,
      data: {
        cleanedCount: cleanedCalls.length,
        thresholdMinutes,
        cleanedCalls: cleanedCalls
      }
    });

  } catch (error) {
    console.error('Errore nella pulizia chiamate:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server durante la pulizia'
    });
  }
};

/**
 * Test endpoint per verificare che i webhook siano raggiungibili
 * GET /api/calls/test-webhook
 */
export const testWebhook = async (req, res) => {
  console.log('🧪 Test webhook chiamato');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Query:', req.query);
  
  res.json({
    success: true,
    message: 'Webhook endpoint raggiungibile',
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
    query: req.query
  });
};

/**
 * Ottieni storia chiamate per un contatto
 * GET /api/calls/contact/:contactId
 */
export const getCallsByContact = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { limit = 10, status } = req.query;

    // Verifica che il contatto esista
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (!req.user.canAccessContact(contact)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per accedere a questo contatto'
      });
    }

    const calls = await Call.findByContact(contactId, {
      limit: parseInt(limit),
      status
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });

  } catch (error) {
    console.error('Errore nel recuperare le chiamate:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni le mie chiamate
 * GET /api/calls/my-calls
 */
export const getMyCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, status, page = 1 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = Call.find({ initiatedBy: userId })
      .populate('contact', 'name phone')
      .populate('initiatedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    if (status) {
      query = query.where({ status });
    }

    const calls = await query;
    const totalCalls = await Call.countDocuments({ 
      initiatedBy: userId,
      ...(status && { status })
    });

    res.json({
      success: true,
      data: calls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCalls / parseInt(limit)),
        totalCalls,
        hasNext: skip + parseInt(limit) < totalCalls,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Errore nel recuperare le chiamate utente:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna note e outcome di una chiamata
 * PUT /api/calls/:callId
 */
export const updateCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const { notes, outcome } = req.body;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Chiamata non trovata'
      });
    }

    // Verifica che l'utente possa modificare questa chiamata
    if (call.initiatedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questa chiamata'
      });
    }

    if (notes !== undefined) call.notes = notes;
    if (outcome !== undefined) {
      call.outcome = outcome;
      
      // Crea l'activity solo ora che abbiamo l'esito
      const activity = new Activity({
        type: 'call',
        contact: call.contact,
        createdBy: req.user._id,
        status: 'completed',
        description: `Chiamata completata - ${outcome}`,
        data: {
          twilioCallSid: call.twilioCallSid,
          callOutcome: outcome,
          direction: 'outbound',
          callDuration: call.duration,
          ...(call.recordingUrl && { recordingUrl: call.recordingUrl }),
          ...(call.recordingSid && { recordingSid: call.recordingSid }),
          ...(call.recordingDuration && { recordingDuration: call.recordingDuration }),
          ...(notes && { notes })
        }
      });
      await activity.save();
    }

    await call.save();
    await call.populate([
      { path: 'contact', select: 'name phone' },
      { path: 'initiatedBy', select: 'firstName lastName' }
    ]);

    res.json({
      success: true,
      message: 'Esito chiamata salvato con successo',
      data: call
    });

  } catch (error) {
    console.error('Errore nell\'aggiornare la chiamata:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni statistiche delle chiamate
 * GET /api/calls/stats
 */
export const getCallStats = async (req, res) => {
  try {
    const { period = '30d', contactId } = req.query;
    const userId = req.user.hasRole('manager') ? req.query.userId : req.user.id;

    // Calcola date range
    const dateFrom = new Date();
    switch (period) {
      case '7d':
        dateFrom.setDate(dateFrom.getDate() - 7);
        break;
      case '30d':
        dateFrom.setDate(dateFrom.getDate() - 30);
        break;
      case '90d':
        dateFrom.setDate(dateFrom.getDate() - 90);
        break;
      default:
        dateFrom.setDate(dateFrom.getDate() - 30);
    }

    const stats = await Call.getCallStats({
      userId,
      contactId,
      dateFrom
    });

    res.json({
      success: true,
      data: stats,
      period,
      dateFrom
    });

  } catch (error) {
    console.error('Errore nel recuperare le statistiche:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni URL della registrazione (con autenticazione)
 * GET /api/calls/:callId/recording
 */
export const getRecording = async (req, res) => {
  try {
    const { callId } = req.params;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Chiamata non trovata'
      });
    }

    // Verifica permessi
    if (call.initiatedBy.toString() !== req.user.id && !req.user.hasRole('manager')) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per accedere a questa registrazione'
      });
    }

    if (!call.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: 'Registrazione non disponibile per questa chiamata'
      });
    }

    res.json({
      success: true,
      data: {
        recordingUrl: call.recordingUrl,
        recordingSid: call.recordingSid,
        duration: call.recordingDuration
      }
    });

  } catch (error) {
    console.error('Errore nel recuperare la registrazione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 

/**
 * Serve una registrazione audio tramite proxy
 * GET /api/calls/recording/:recordingSid
 */
export const getRecordingProxy = async (req, res) => {
  try {
    const { recordingSid } = req.params;
    
    console.log(`🎵 Richiesta registrazione: ${recordingSid}`);
    
    // Verifica che il recordingSid esista nel database (per sicurezza)
    const call = await Call.findOne({ recordingSid });
    if (!call) {
      console.log(`❌ Recording non trovato nel DB: ${recordingSid}`);
      return res.status(404).json({
        success: false,
        message: 'Registrazione non trovata'
      });
    }
    
    console.log(`✅ Recording trovato nel DB per la chiamata: ${call.twilioCallSid}`);

    // Costruisci l'URL della registrazione Twilio
    const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}`;
    console.log(`📡 URL Twilio: ${recordingUrl}`);
    
    // Fai la richiesta a Twilio con le credenziali
    const response = await fetch(recordingUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`
      }
    });

    console.log(`📞 Risposta Twilio: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`❌ Errore Twilio: ${response.status}`);
      return res.status(404).json({
        success: false,
        message: 'Registrazione non trovata'
      });
    }

    // Ottieni il tipo di contenuto dalla risposta Twilio
    const contentType = response.headers.get('content-type') || 'audio/wav';
    console.log(`🎵 Content-Type: ${contentType}`);

    // Imposta gli header appropriati per l'audio
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="recording-${recordingSid}.wav"`);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache per 1 ora
    
    // Converti la risposta in buffer e inviala
    const audioBuffer = await response.arrayBuffer();
    res.send(Buffer.from(audioBuffer));
    console.log(`✅ Streaming registrazione ${recordingSid}`);

  } catch (error) {
    console.error('Errore nel servire la registrazione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore nel caricare la registrazione'
    });
  }
}; 