import dotenv from 'dotenv';
import { create } from '@open-wa/wa-automate';
import fs from 'fs';
import https from 'https';
import path from 'path';
import os from 'os';

dotenv.config({ path: './crm.env' });

async function testPtt() {
  const client = await create({
    sessionId: 'test-ptt-local',
    headless: false,
    qrTimeout: 60,
    authTimeout: 60,
    useChrome: true,
    licenseKey: process.env.OPENWA_LICENSE_KEY
  });

  const testNumber = '393663153304';
  const chatId = `${testNumber}@c.us`;
  // Test SENZA query params (updatedAt)
  const imagekitMp3Url = 'https://ik.imagekit.io/menuchat/whatsapp-campaign-audio/voice-1762517002261_qYyIBPMCd.mp3';

  console.log('\n🎤 === TEST PTT CON URL IMAGEKIT MP3 ===\n');
  console.log(`📝 URL: ${imagekitMp3Url}\n`);
  
  // TEST: sendFile con URL ImageKit MP3 + ptt=true
  console.log('🧪 TEST: sendFile con URL ImageKit MP3 e ptt=true');
  console.log('   (Metodo che useremo in produzione)');
  let r1;
  try {
    r1 = await client.sendFile(
      chatId, 
      imagekitMp3Url, // URL pubblico ImageKit!
      'voice.mp3', 
      '', // caption
      null, // quotedMsgId
      true, // waitForId
      true // ptt=true ← NOTA VOCALE
    );
    console.log(`   ✅ Risultato: ${r1}`);
    console.log(`   Tipo: ${typeof r1}`);
    console.log(`   Successo: ${r1 && r1 !== false ? '✅ SÌ - VOCALE INVIATO!' : '❌ NO'}\n`);
  } catch (e) {
    console.log(`   ❌ Errore: ${e.message}\n`);
    r1 = false;
  }

  // Summary
  console.log('📊 === RISULTATO ===');
  if (r1 && r1 !== false) {
    console.log('🎉 🎉 🎉 URL IMAGEKIT MP3 FUNZIONA! 🎉 🎉 🎉');
    console.log(`   MessageId: ${r1}`);
    console.log('   Controlla WhatsApp +39 366 315 3304\n');
    console.log('❓ DOMANDE:');
    console.log('   1. È arrivato?');
    console.log('   2. È RIPRODUCIBILE (no "file non disponibile")?');
    console.log('   3. È NOTA VOCALE (icona 🎤, non file)?');
    console.log('\n   Se TUTTE ✅ → PRONTO PER PRODUZIONE!');
    console.log('   Usiamo URL ImageKit diretto, NO file temp!');
  } else {
    console.log('❌ URL ImageKit MP3 non funziona');
    console.log('   Torniamo a DataURL...\n');
  }

  console.log('✅ Test completato - controlla WhatsApp\n');
  
  await client.kill();
  process.exit(0);
}

testPtt();

