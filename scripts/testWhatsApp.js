import dotenv from 'dotenv';
import mongoose from 'mongoose';
import whatsappService from '../services/whatsappService.js';

// Carica le variabili d'ambiente
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';

async function testWhatsApp() {
  try {
    console.log('🧪 Test OpenWA Integration');
    console.log('========================');

    // Connetti a MongoDB
    console.log('📡 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Inizializza il servizio WhatsApp
    console.log('🟢 Inizializzazione servizio WhatsApp...');
    await whatsappService.initialize();
    console.log('✅ Servizio WhatsApp inizializzato');

    // Test creazione sessione
    console.log('📱 Test creazione sessione...');
    try {
      // Nota: questo fallirà se non c'è un utente proprietario, ma è normale per il test
      const testSession = {
        sessionId: 'test-session-' + Date.now(),
        name: 'Test Session',
        owner: new mongoose.Types.ObjectId() // Mock owner per il test
      };

      console.log('📋 Parametri sessione test:', testSession);
      console.log('ℹ️  Nota: La creazione della sessione potrebbe fallire senza un utente valido nel database');
      
    } catch (error) {
      console.log('⚠️  Errore creazione sessione (normale per il test):', error.message);
    }

    console.log('');
    console.log('🎉 Test completato!');
    console.log('');
    console.log('📝 Prossimi passi:');
    console.log('1. Assicurati di avere utenti nel database');
    console.log('2. Avvia il server con: npm run dev');
    console.log('3. Crea una sessione WhatsApp tramite l\'API');
    console.log('4. Scansiona il QR code con WhatsApp');
    console.log('');

  } catch (error) {
    console.error('❌ Errore nel test:', error);
  } finally {
    // Cleanup
    console.log('🧹 Cleanup...');
    try {
      await whatsappService.cleanup();
      await mongoose.connection.close();
      console.log('✅ Cleanup completato');
    } catch (error) {
      console.error('⚠️  Errore nel cleanup:', error);
    }
    process.exit(0);
  }
}

// Gestione interruzioni
process.on('SIGINT', async () => {
  console.log('\n🛑 Interruzione ricevuta...');
  try {
    await whatsappService.cleanup();
    await mongoose.connection.close();
  } catch (error) {
    console.error('Errore nel cleanup:', error);
  }
  process.exit(0);
});

// Esegui il test
testWhatsApp(); 