import mongoose from 'mongoose';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per pulire le chiamate bloccate in coda
 * Annulla automaticamente le chiamate in stato 'queued', 'ringing' o 'in-progress'
 * che sono più vecchie di X minuti
 */

const STUCK_CALL_THRESHOLD = 2 * 60 * 1000; // 2 minuti in millisecondi

async function cleanStuckCalls() {
  try {
    console.log('🧹 Avvio pulizia chiamate bloccate...');
    
    // Connetti al database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connesso al database');

    // Trova tutte le chiamate bloccate
    const cutoffTime = new Date(Date.now() - STUCK_CALL_THRESHOLD);
    
    const stuckCalls = await Call.find({
      status: { $in: ['queued', 'ringing', 'in-progress'] },
      createdAt: { $lt: cutoffTime }
    }).populate('initiatedBy', 'firstName lastName email');

    console.log(`🔍 Trovate ${stuckCalls.length} chiamate bloccate da più di 2 minuti`);

    if (stuckCalls.length === 0) {
      console.log('✅ Nessuna chiamata bloccata trovata');
      return;
    }

    // Processa ogni chiamata bloccata
    for (const call of stuckCalls) {
      console.log(`📞 Pulizia chiamata: ${call.twilioCallSid} (${call.status}) - Utente: ${call.initiatedBy?.firstName} ${call.initiatedBy?.lastName}`);
      
      // Aggiorna lo stato della chiamata
      await call.updateStatus('failed', { 
        reason: 'Auto-cleanup - chiamata bloccata',
        cleanupTimestamp: new Date()
      });

      // Aggiorna l'attività correlata
      const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
      if (activity) {
        activity.status = 'completed';
        activity.description += ' - AUTO-CLEANUP (chiamata bloccata)';
        activity.data = {
          ...activity.data,
          callOutcome: 'failed',
          reason: 'auto_cleanup_stuck'
        };
        await activity.save();
        console.log(`  ✅ Attività aggiornata: ${activity._id}`);
      }
    }

    console.log(`✅ Pulite ${stuckCalls.length} chiamate bloccate`);

    // Mostra statistiche finali
    const activeCallsAfter = await Call.countDocuments({
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    });
    
    console.log(`📊 Chiamate ancora attive dopo la pulizia: ${activeCallsAfter}`);

  } catch (error) {
    console.error('❌ Errore durante la pulizia:', error);
    process.exit(1);
  } finally {
    // Chiudi la connessione al database
    await mongoose.disconnect();
    console.log('🔌 Disconnesso dal database');
  }
}

// Funzione per pulire chiamate di un utente specifico
async function cleanUserStuckCalls(userEmail) {
  try {
    console.log(`🧹 Pulizia chiamate bloccate per utente: ${userEmail}`);
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Trova l'utente
    const User = mongoose.model('User');
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      console.log(`❌ Utente non trovato: ${userEmail}`);
      return;
    }

    // Trova chiamate bloccate dell'utente
    const stuckCalls = await Call.find({
      initiatedBy: user._id,
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    });

    console.log(`🔍 Trovate ${stuckCalls.length} chiamate bloccate per ${userEmail}`);

    for (const call of stuckCalls) {
      console.log(`📞 Pulizia chiamata: ${call.twilioCallSid} (${call.status})`);
      
      await call.updateStatus('canceled', { 
        reason: 'Manual cleanup by admin',
        cleanupTimestamp: new Date()
      });

      const activity = await Activity.findOne({ 'data.twilioCallSid': call.twilioCallSid });
      if (activity) {
        activity.status = 'completed';
        activity.description += ' - MANUAL CLEANUP';
        activity.data = {
          ...activity.data,
          callOutcome: 'canceled',
          reason: 'manual_cleanup'
        };
        await activity.save();
      }
    }

    console.log(`✅ Pulite ${stuckCalls.length} chiamate per ${userEmail}`);

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
    cleanUserStuckCalls(args[1]);
  } else {
    console.log('❌ Specifica un email utente: npm run clean-calls -- --user email@example.com');
  }
} else {
  cleanStuckCalls();
}

export { cleanStuckCalls, cleanUserStuckCalls }; 