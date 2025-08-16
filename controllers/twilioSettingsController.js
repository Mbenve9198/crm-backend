import twilio from 'twilio';
import User from '../models/userModel.js';

/**
 * Controller per la gestione delle impostazioni Twilio dell'utente
 */

/**
 * Ottieni configurazione Twilio dell'utente corrente
 * GET /api/settings/twilio
 */
export const getTwilioSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const twilioConfig = user.getTwilioConfig();

    res.json({
      success: true,
      data: twilioConfig || {
        accountSid: '',
        phoneNumber: '',
        isVerified: false,
        isEnabled: false,
        lastVerified: null
      }
    });

  } catch (error) {
    console.error('Errore nel recuperare configurazione Twilio:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Configura credenziali Twilio per l'utente
 * POST /api/settings/twilio/configure
 */
export const configureTwilio = async (req, res) => {
  try {
    const { accountSid, authToken, phoneNumber } = req.body;

    // Validazione input
    if (!accountSid || !authToken || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Account SID, Auth Token e numero di telefono sono obbligatori'
      });
    }

    // Valida formato numero (E.164)
    if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Il numero deve essere in formato internazionale (es. +393331234567)'
      });
    }

    const user = await User.findById(req.user.id);
    await user.configureTwilio({ accountSid, authToken, phoneNumber });

    res.json({
      success: true,
      message: 'Configurazione Twilio salvata. Procedi con la verifica.',
      data: user.getTwilioConfig()
    });

  } catch (error) {
    console.error('Errore nella configurazione Twilio:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Verifica configurazione Twilio testando una chiamata
 * POST /api/settings/twilio/verify
 */
export const verifyTwilio = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+settings.twilio.authToken');
    
    if (!user.settings?.twilio?.accountSid || !user.settings?.twilio?.authToken) {
      return res.status(400).json({
        success: false,
        message: 'Configurazione Twilio non trovata. Configura prima le credenziali.'
      });
    }

    // Testa la connessione a Twilio
    try {
      const client = twilio(
        user.settings.twilio.accountSid,
        user.settings.twilio.authToken
      );

      // Verifica account
      const account = await client.api.accounts(user.settings.twilio.accountSid).fetch();
      
      // Verifica che il numero sia presente nell'account (prima controlla i numeri verificati)
      let hasValidNumber = false;
      let numberType = '';

      // 1. Controlla nei numeri verificati (Verified Caller IDs) - priorità per numeri personali
      try {
        const verifiedNumbers = await client.outgoingCallerIds.list();
        const hasVerifiedNumber = verifiedNumbers.some(
          number => number.phoneNumber === user.settings.twilio.phoneNumber
        );
        
        if (hasVerifiedNumber) {
          hasValidNumber = true;
          numberType = 'verified';
        }
      } catch (error) {
        console.log('Errore nel controllare numeri verificati:', error.message);
      }

      // 2. Se non trovato nei verificati, controlla nei numeri Twilio acquistati
      if (!hasValidNumber) {
        try {
          const phoneNumbers = await client.incomingPhoneNumbers.list();
          const hasTwilioNumber = phoneNumbers.some(
            number => number.phoneNumber === user.settings.twilio.phoneNumber
          );
          
          if (hasTwilioNumber) {
            hasValidNumber = true;
            numberType = 'twilio';
          }
        } catch (error) {
          console.log('Errore nel controllare numeri Twilio:', error.message);
        }
      }

      if (!hasValidNumber) {
        return res.status(400).json({
          success: false,
          message: `Il numero ${user.settings.twilio.phoneNumber} non è associato a questo account Twilio. 
                   Per usare il tuo numero personale, devi prima verificarlo come "Verified Caller ID" nella console Twilio:
                   https://console.twilio.com/us1/develop/phone-numbers/manage/verified`
        });
      }

      // Se tutto è OK, marca come verificato
      await user.verifyTwilio();

      res.json({
        success: true,
        message: `Configurazione Twilio verificata con successo! Numero ${numberType === 'verified' ? 'verificato' : 'Twilio'} confermato.`,
        data: {
          accountName: account.friendlyName,
          accountSid: account.sid,
          phoneNumber: user.settings.twilio.phoneNumber,
          numberType: numberType,
          isVerified: true,
          isEnabled: true
        }
      });

    } catch (twilioError) {
      console.error('Errore verifica Twilio:', twilioError);
      
      let errorMessage = 'Errore nella verifica delle credenziali Twilio';
      
      if (twilioError.code === 20003) {
        errorMessage = 'Credenziali Twilio non valide. Verifica Account SID e Auth Token.';
      } else if (twilioError.code === 20404) {
        errorMessage = 'Account Twilio non trovato. Verifica l\'Account SID.';
      } else if (twilioError.message) {
        errorMessage = `Errore Twilio: ${twilioError.message}`;
      }

      return res.status(400).json({
        success: false,
        message: errorMessage,
        twilioError: {
          code: twilioError.code,
          message: twilioError.message
        }
      });
    }

  } catch (error) {
    console.error('Errore nella verifica Twilio:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Disabilita Twilio per l'utente
 * POST /api/settings/twilio/disable
 */
export const disableTwilio = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    await user.disableTwilio();

    res.json({
      success: true,
      message: 'Twilio disabilitato con successo',
      data: user.getTwilioConfig()
    });

  } catch (error) {
    console.error('Errore nel disabilitare Twilio:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Test di una chiamata (per verificare che tutto funzioni)
 * POST /api/settings/twilio/test-call
 */
export const testCall = async (req, res) => {
  try {
    const { testNumber } = req.body;

    if (!testNumber) {
      return res.status(400).json({
        success: false,
        message: 'Numero di test richiesto'
      });
    }

    const user = await User.findById(req.user.id).select('+settings.twilio.authToken');
    
    if (!user.hasTwilioEnabled()) {
      return res.status(400).json({
        success: false,
        message: 'Twilio non configurato o non verificato'
      });
    }

    const client = twilio(
      user.settings.twilio.accountSid,
      user.settings.twilio.authToken
    );

    // Crea una chiamata di test con messaggio vocale
    const call = await client.calls.create({
      from: user.settings.twilio.phoneNumber,
      to: testNumber,
      twiml: `<Response>
                <Say language="it" voice="alice">
                  Ciao! Questo è un test di configurazione Twilio per il CRM MenuChat. 
                  La configurazione funziona correttamente. Arrivederci!
                </Say>
              </Response>`,
      timeout: 30
    });

    res.json({
      success: true,
      message: 'Chiamata di test iniziata con successo',
      data: {
        callSid: call.sid,
        status: call.status,
        to: testNumber,
        from: user.settings.twilio.phoneNumber
      }
    });

  } catch (error) {
    console.error('Errore nella chiamata di test:', error);
    
    if (error.code) {
      return res.status(400).json({
        success: false,
        message: `Errore Twilio: ${error.message}`,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 