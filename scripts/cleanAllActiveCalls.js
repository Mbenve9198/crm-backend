import mongoose from 'mongoose';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per pulire TUTTE le chiamate attive
 * Rimuove tutte le chiamate in stato 'queued', 'ringing' o 'in-progress'
 * INDIPENDENTEMENTE dalla loro età
 */

async function cleanAllActiveCalls() {
  try {
    console.log('🧹 PULIZIA COMPLETA - Rimozione di TUTTE le chiamate attive...');
    
    // Connetti al database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connesso al database');

    // Trova TUTTE le chiamate attive
    const activeCalls = await Call.find({
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    }).populate('initiatedBy', 'firstName lastName email');

    console.log(`🔍 Trovate ${activeCalls.length} chiamate attive DA PULIRE`);

    if (activeCalls.length === 0) {
      console.log('✅ Nessuna chiamata attiva trovata');
      return;
    }

    // Processa ogni chiamata attiva
    for (const call of activeCalls) {
      console.log(`📞 PULIZIA: ${call.twilioCallSid} (${call.status}) - Utente: ${call.initiatedBy?.firstName} ${call.initiatedBy?.lastName} - Creata: ${call.createdAt}`);
      
      // Aggiorna lo stato della chiamata
      await call.updateStatus('canceled', { 
        reason: 'FORCE CLEANUP - Pulizia completa sistema',
        cleanupTimestamp: new Date(),
        forceCleanup: true
      });

      // Aggiorna l'attività correlata
      const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
      if (activity) {
        activity.status = 'completed';
        activity.description += ' - FORCE CLEANUP (sistema pulito)';
        activity.data = {
          ...activity.data,
          callOutcome: 'canceled',
          reason: 'force_cleanup_all'
        };
        await activity.save();
        console.log(`  ✅ Attività aggiornata: ${activity._id}`);
      }
    }

    console.log(`✅ PULITE ${activeCalls.length} chiamate attive`);
    console.log('🎉 SISTEMA PULITO - Nessuna chiamata in coda rimanente');

    // Verifica finale
    const remainingCalls = await Call.countDocuments({
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    });
    
    if (remainingCalls === 0) {
      console.log('✅ CONFERMA: Zero chiamate attive rimaste nel sistema');
    } else {
      console.log(`⚠️  ATTENZIONE: ${remainingCalls} chiamate ancora attive!`);
    }

  } catch (error) {
    console.error('❌ Errore durante la pulizia completa:', error);
    process.exit(1);
  } finally {
    // Chiudi la connessione al database
    await mongoose.disconnect();
    console.log('🔌 Disconnesso dal database');
  }
}

// Funzione per pulire tutte le chiamate di un utente specifico
async function cleanAllUserCalls(userEmail) {
  try {
    console.log(`🧹 PULIZIA COMPLETA per utente: ${userEmail}`);
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Trova l'utente
    const User = mongoose.model('User');
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      console.log(`❌ Utente non trovato: ${userEmail}`);
      return;
    }

    // Trova TUTTE le chiamate attive dell'utente
    const userCalls = await Call.find({
      initiatedBy: user._id,
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    });

    console.log(`🔍 Trovate ${userCalls.length} chiamate attive per ${userEmail}`);

    for (const call of userCalls) {
      console.log(`📞 PULIZIA: ${call.twilioCallSid} (${call.status}) - ${call.createdAt}`);
      
      await call.updateStatus('canceled', { 
        reason: 'Force cleanup by admin - all user calls',
        cleanupTimestamp: new Date(),
        forceCleanup: true
      });

      const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
      if (activity) {
        activity.status = 'completed';
        activity.description += ' - FORCE CLEANUP';
        activity.data = {
          ...activity.data,
          callOutcome: 'canceled',
          reason: 'force_cleanup_user'
        };
        await activity.save();
      }
    }

    console.log(`✅ PULITE TUTTE le ${userCalls.length} chiamate per ${userEmail}`);

  } catch (error) {
    console.error('❌ Errore:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Esegui lo script
const args = process.argv.slice(2);
if (args.length > 0 && args[0] === '--user') {
  if (args[1]) {
    cleanAllUserCalls(args[1]);
  } else {
    console.log('❌ Specifica un email utente: npm run clean-all-calls -- --user email@example.com');
  }
} else {
  cleanAllActiveCalls();
}

export { cleanAllActiveCalls, cleanAllUserCalls }; 