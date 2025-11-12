import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { create } from '@open-wa/wa-automate';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Carica variabili ambiente
dotenv.config({ path: './crm.env' });

/**
 * Test locale sendPtt con sessione diretta
 */
async function testLocalSendPtt() {
  try {
    console.log('\n🧪 === TEST LOCALE sendPtt ===\n');

    // Connetti a MongoDB
    console.log('📊 Connessione a MongoDB remoto...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connesso\n');

    // Crea client OpenWA locale
    console.log('🔌 Creazione client WhatsApp locale...');
    console.log('📱 Scansiona il QR code che apparirà...\n');

    const client = await create({
      sessionId: 'test-ptt-local',
      headless: false, // Mostra browser per QR
      qrTimeout: 60,
      authTimeout: 60,
      useChrome: true,
      killClientOnLogout: false,
      logConsole: false,
      licenseKey: process.env.OPENWA_LICENSE_KEY // 🔑 USA LA LICENZA!
    });

    console.log('✅ Client WhatsApp connesso!\n');

    // Numero di test (il tuo)
    const testNumber = process.argv[2] || '393934274642';
    const chatId = `${testNumber.replace(/[^0-9]/g, '')}@c.us`;

    console.log(`📞 Numero test: ${testNumber}`);
    console.log(`📞 ChatId: ${chatId}\n`);

    // Usa file OPUS (formato nativo WhatsApp PTT!)
    const realAudioFile = './Viale-Belfiore-45.opus';
    
    if (!fs.existsSync(realAudioFile)) {
      console.error(`❌ File non trovato: ${realAudioFile}`);
      console.log('💡 Assicurati che il file sia nella cartella crm-backend-main\n');
      process.exit(1);
    }
    
    const fileStats = fs.statSync(realAudioFile);
    console.log(`📝 File audio trovato: ${realAudioFile}`);
    console.log(`   Dimensione: ${(fileStats.size / 1024).toFixed(2)} KB\n`);

    // Converti in DataURL con mime type OPUS corretto
    const fileBuffer = fs.readFileSync(realAudioFile);
    const base64 = fileBuffer.toString('base64');
    const dataUrl = `data:audio/ogg;codecs=opus;base64,${base64}`; // 🎤 Formato WhatsApp PTT!
    console.log(`📝 DataURL generato: ${(dataUrl.length / 1024).toFixed(2)} KB`);
    console.log(`📝 Mime type: audio/ogg;codecs=opus (WhatsApp PTT nativo)\n`);

    // TEST 1: sendText (verifica che il client funzioni)
    console.log('🧪 TEST 1: sendText (verifica client funzionante)');
    console.log('   Invio in corso...');
    let resultText;
    try {
      resultText = await client.sendText(chatId, '🧪 Test messaggio');
      console.log(`   ✅ Risultato: ${resultText}`);
      console.log(`   Successo: ${resultText !== false ? '✅ SÌ' : '❌ NO'}\n`);
    } catch (e) {
      console.log(`   ❌ Errore: ${e.message}\n`);
      resultText = false;
    }

    // Aspetta 3 secondi
    await new Promise(r => setTimeout(r, 3000));

    // TEST 2: sendAudio (audio normale, non PTT)
    console.log('🧪 TEST 2: sendAudio (audio normale, NON PTT)');
    console.log('   Invio in corso...');
    let result2;
    try {
      result2 = await client.sendAudio(chatId, dataUrl);
      console.log(`   ✅ Risultato: ${result2}`);
      console.log(`   Successo: ${result2 !== false ? '✅ SÌ - Audio inviato!' : '❌ NO'}\n`);
    } catch (e) {
      console.log(`   ❌ Errore: ${e.message}\n`);
      result2 = false;
    }

    // Summary
    console.log('📊 === RISULTATI ===');
    console.log(`sendText: ${resultText !== false ? '✅ FUNZIONA' : '❌ FALLITO'}`);
    console.log(`sendAudio: ${result2 !== false ? '✅ FUNZIONA' : '❌ FALLITO'}\n`);
    
    if (resultText === false) {
      console.log('❌ Anche sendText fallisce - problema nella sessione/connessione\n');
    } else if (result2 !== false) {
      console.log('✅ ✅ ✅ sendAudio FUNZIONA! ✅ ✅ ✅');
      console.log(`   MessageId: ${result2}`);
      console.log('   Audio inviato come file audio (non PTT)!');
      console.log('   Controlla WhatsApp - dovrebbe esserci.\n');
      console.log('💡 SOLUZIONE: Usa sendAudio invece di sendPtt');
      console.log('   Arriva come audio player invece di nota vocale\n');
    } else {
      console.log('❌ sendText funziona ma sendAudio no');
      console.log('   sendPtt è probabilmente broken in OpenWA 4.76.0\n');
    }

    // Chiudi
    await client.kill();
    await mongoose.disconnect();
    console.log('✅ Test completato\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Errore durante il test:', error);
    process.exit(1);
  }
}

// Esegui
testLocalSendPtt();

