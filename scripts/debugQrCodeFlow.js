import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per debuggare il flusso del QR code delle sessioni WhatsApp
 */

const debugQrCodeFlow = async () => {
  try {
    // Connessione a MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Importa il modello WhatsappSession
    const { default: WhatsappSession } = await import('../models/whatsappSessionModel.js');

    console.log('\n🔍 Debug QR Code Flow - Analisi Sessioni WhatsApp\n');
    console.log('='.repeat(60));

    // Trova tutte le sessioni
    const sessions = await WhatsappSession.find({}).populate('owner', 'firstName lastName email');
    
    if (sessions.length === 0) {
      console.log('❌ Nessuna sessione WhatsApp trovata nel database');
      console.log('\n💡 Suggerimenti:');
      console.log('   1. Vai su /whatsapp-campaigns');
      console.log('   2. Crea una nuova sessione');
      console.log('   3. Riprova questo script');
      return;
    }

    console.log(`📊 Trovate ${sessions.length} sessioni:\n`);

    for (const session of sessions) {
      console.log(`📱 Sessione: ${session.name} (${session.sessionId})`);
      console.log(`   👤 Owner: ${session.owner?.firstName} ${session.owner?.lastName} (${session.owner?.email})`);
      console.log(`   📞 Numero: ${session.phoneNumber}`);
      console.log(`   🔄 Status: ${session.status}`);
      
      // Analisi QR Code
      if (session.qrCode) {
        const qrAge = session.qrGeneratedAt ? Date.now() - new Date(session.qrGeneratedAt).getTime() : 0;
        const qrAgeMinutes = Math.floor(qrAge / (1000 * 60));
        const isExpired = qrAgeMinutes > 5;
        
        console.log(`   📱 QR Code: ✅ PRESENTE`);
        console.log(`   ⏰ Generato: ${session.qrGeneratedAt?.toLocaleString()}`);
        console.log(`   🕒 Età: ${qrAgeMinutes} minuti`);
        console.log(`   ${isExpired ? '❌ SCADUTO' : '✅ VALIDO'}`);
        console.log(`   📏 Lunghezza: ${session.qrCode.length} caratteri`);
        console.log(`   🔗 Formato: ${session.qrCode.startsWith('data:image') ? 'Data URL' : 'Raw string'}`);
        
        if (isExpired) {
          console.log(`   ⚠️ PROBLEMA: QR code scaduto (${qrAgeMinutes} min > 5 min)`);
        }
      } else {
        console.log(`   📱 QR Code: ❌ ASSENTE`);
        console.log(`   💡 Possibili cause:`);
        console.log(`      - Sessione non in stato 'qr_ready'`);
        console.log(`      - OpenWA non ha generato il QR`);
        console.log(`      - Errore nella creazione della sessione`);
      }
      
      // Analisi eventi
      const recentEvents = session.eventLogs?.slice(-3) || [];
      if (recentEvents.length > 0) {
        console.log(`   📋 Ultimi eventi:`);
        recentEvents.forEach(event => {
          const timestamp = new Date(event.timestamp).toLocaleString();
          console.log(`      - ${event.event} (${timestamp})`);
        });
      }
      
      console.log(`   🔧 Config: Chrome=${session.config?.useChrome}, Headless=${session.config?.headless}`);
      console.log(`   📅 Ultima attività: ${session.lastActivity?.toLocaleString() || 'Mai'}`);
      console.log('   ' + '─'.repeat(50));
    }

    console.log('\n🔬 Test API Endpoint');
    console.log('─'.repeat(30));
    
    // Testa l'endpoint API per ogni sessione
    for (const session of sessions) {
      console.log(`\n🧪 Test endpoint per: ${session.sessionId}`);
      
      try {
        // Simula la logica dell'endpoint getQrCode
        if (!session.qrCode) {
          console.log(`   ❌ QR code non disponibile`);
          console.log(`   📝 Response: 404 - "QR code non disponibile. Verifica lo stato della sessione."`);
          continue;
        }

        // Verifica scadenza (5 minuti)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (session.qrGeneratedAt < fiveMinutesAgo) {
          console.log(`   ❌ QR code scaduto`);
          console.log(`   📝 Response: 410 - "QR code scaduto. Riconnetti la sessione."`);
          continue;
        }

        console.log(`   ✅ QR code valido`);
        console.log(`   📝 Response: 200 - QR code disponibile`);
        console.log(`   📊 Data:`);
        console.log(`      - qrCode: ${session.qrCode.substring(0, 50)}...`);
        console.log(`      - generatedAt: ${session.qrGeneratedAt}`);
        console.log(`      - expiresAt: ${new Date(session.qrGeneratedAt.getTime() + 5 * 60 * 1000)}`);
        
      } catch (error) {
        console.log(`   ❌ Errore nel test: ${error.message}`);
      }
    }

    console.log('\n🚀 Raccomandazioni');
    console.log('='.repeat(30));
    
    const sessionsWithValidQR = sessions.filter(s => {
      if (!s.qrCode || !s.qrGeneratedAt) return false;
      const qrAge = Date.now() - new Date(s.qrGeneratedAt).getTime();
      return qrAge <= 5 * 60 * 1000; // 5 minuti
    });
    
    const sessionsWithExpiredQR = sessions.filter(s => {
      if (!s.qrCode || !s.qrGeneratedAt) return false;
      const qrAge = Date.now() - new Date(s.qrGeneratedAt).getTime();
      return qrAge > 5 * 60 * 1000; // 5 minuti
    });
    
    const sessionsWithoutQR = sessions.filter(s => !s.qrCode);
    
    console.log(`📊 Sessioni con QR valido: ${sessionsWithValidQR.length}`);
    console.log(`⏰ Sessioni con QR scaduto: ${sessionsWithExpiredQR.length}`);
    console.log(`❌ Sessioni senza QR: ${sessionsWithoutQR.length}`);
    
    if (sessionsWithValidQR.length > 0) {
      console.log(`\n✅ Sessioni pronte per test frontend:`);
      sessionsWithValidQR.forEach(s => {
        console.log(`   - ${s.sessionId} (${s.name})`);
      });
    }
    
    if (sessionsWithoutQR.length > 0) {
      console.log(`\n⚠️ Sessioni che richiedono riconnessione:`);
      sessionsWithoutQR.forEach(s => {
        console.log(`   - ${s.sessionId} (${s.name}) - Status: ${s.status}`);
      });
    }
    
    if (sessionsWithExpiredQR.length > 0) {
      console.log(`\n🔄 Sessioni con QR scaduto (necessaria riconnessione):`);
      sessionsWithExpiredQR.forEach(s => {
        console.log(`   - ${s.sessionId} (${s.name})`);
      });
    }

    console.log('\n💡 Passi per il debug:');
    console.log('1. Se nessuna sessione ha QR: ricrea le sessioni WhatsApp');
    console.log('2. Se QR scaduto: usa pulsante Riconnetti nel frontend');
    console.log('3. Se QR valido ma dialog non appare: verifica console frontend');
    console.log('4. Controlla i log del server durante la creazione sessione');

  } catch (error) {
    console.error('❌ Errore generale:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Disconnesso dal database');
  }
};

// Esegui il debug
debugQrCodeFlow(); 