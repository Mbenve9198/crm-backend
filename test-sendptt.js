import dotenv from 'dotenv';
import mongoose from 'mongoose';
import WhatsappSession from './models/whatsappSessionModel.js';
import whatsappService from './services/whatsappService.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Carica variabili ambiente
dotenv.config({ path: './crm.env' });

/**
 * Test diagnostico sendPtt
 * Verifica se sendPtt funziona con file temp
 */
async function testSendPtt() {
  try {
    console.log('🧪 === TEST DIAGNOSTICO sendPtt ===\n');

    // Connetti a MongoDB
    console.log('📊 Connessione a MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connesso\n');

    // Trova sessione attiva
    console.log('🔍 Ricerca sessione WhatsApp attiva...');
    const session = await WhatsappSession.findOne({
      status: { $in: ['connected', 'authenticated'] }
    }).sort({ updatedAt: -1 });

    if (!session) {
      console.error('❌ Nessuna sessione attiva trovata');
      process.exit(1);
    }

    console.log(`✅ Sessione trovata: ${session.name} (${session.sessionId})`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Phone: ${session.phoneNumber}\n`);

    // Crea file audio di test piccolo (vuoto, solo per test)
    console.log('📝 Creazione file audio di test...');
    const testFile = path.join(os.tmpdir(), `test-voice-${Date.now()}.ogg`);
    
    // DataURL di un audio OGG molto piccolo (vuoto, ~1KB)
    const tinyOggDataUrl = 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABpFVEsAAAAAJZ8W4sBHgF2b3JiaXMAAAAAAUSsAAAAAAAAgLsAAAAAAAC4AU9nZ1MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    
    const matches = tinyOggDataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (matches) {
      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(testFile, buffer);
      console.log(`✅ File test creato: ${testFile} (${buffer.length} bytes)\n`);
    }

    // Ottieni client dalla sessione
    console.log('🔌 Recupero client WhatsApp...');
    const client = whatsappService.sessions.get(session.sessionId);
    
    if (!client) {
      console.error(`❌ Client non trovato per sessione ${session.sessionId}`);
      console.log('💡 Prova a riavviare la sessione nel CRM\n');
      process.exit(1);
    }

    console.log('✅ Client WhatsApp recuperato\n');

    // Test numero (usa il tuo numero WhatsApp per test)
    const testNumber = process.argv[2] || '393934274642'; // Numero dalla env o argomento
    const chatId = `${testNumber.replace(/[^0-9]/g, '')}@c.us`;

    console.log(`📞 Numero test: ${testNumber}`);
    console.log(`📞 ChatId: ${chatId}\n`);

    // TEST 1: sendPtt con file path
    console.log('🧪 TEST 1: sendPtt con file path locale');
    const result1 = await client.sendPtt(chatId, testFile);
    console.log(`   Risultato: ${result1}`);
    console.log(`   Tipo: ${typeof result1}`);
    console.log(`   Successo: ${result1 !== false}\n`);

    // TEST 2: sendPtt con DataURL
    console.log('🧪 TEST 2: sendPtt con DataURL');
    const result2 = await client.sendPtt(chatId, tinyOggDataUrl);
    console.log(`   Risultato: ${result2}`);
    console.log(`   Tipo: ${typeof result2}`);
    console.log(`   Successo: ${result2 !== false}\n`);

    // Cleanup
    fs.unlinkSync(testFile);
    console.log('🧹 File test eliminato\n');

    // Summary
    console.log('📊 === RISULTATI ===');
    console.log(`File path: ${result1 !== false ? '✅ FUNZIONA' : '❌ FALLITO'}`);
    console.log(`DataURL: ${result2 !== false ? '✅ FUNZIONA' : '❌ FALLITO'}`);
    
    if (result1 === false && result2 === false) {
      console.log('\n⚠️  ENTRAMBI FALLITI - Possibili cause:');
      console.log('   1. Numero non valido o non su WhatsApp');
      console.log('   2. Sessione non ha permessi per inviare PTT');
      console.log('   3. Formato OGG non supportato');
      console.log('   4. Account WhatsApp con restrizioni');
    }

    await mongoose.disconnect();
    console.log('\n✅ Test completato');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Errore durante il test:', error);
    process.exit(1);
  }
}

// Esegui
console.log('');
testSendPtt();



