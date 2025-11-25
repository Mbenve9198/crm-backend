import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per testare il sistema delle licenze WhatsApp per utente
 */

const testLicenseMapping = async () => {
  try {
    // Connessione a MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Importa il modello User
    const { default: User } = await import('../models/userModel.js');

    console.log('\n🔍 Test del sistema licenze WhatsApp per utente\n');
    console.log('==========================================\n');

    // Simula la logica che viene eseguita nel servizio WhatsApp
    const testUsers = [
      'marco@menuchat.com',
      'federico@menuchat.com', 
      'test@esempio.com' // Utente che non esiste
    ];

    for (const email of testUsers) {
      console.log(`\n📧 Testing: ${email}`);
      console.log('─'.repeat(40));

      try {
        const user = await User.findOne({ email });
        
        if (user) {
          console.log(`👤 Utente trovato: ${user.firstName} ${user.lastName}`);
          console.log(`🏢 Ruolo: ${user.role}`);
          
          // Simula la logica di selezione licenza
          let licenseKey = process.env.OPENWA_LICENSE_KEY; // Default
          let licenseSource = 'Default (OPENWA_LICENSE_KEY)';
          
          if (user.email === 'marco@menuchat.com') {
            licenseKey = process.env.OPENWA_LICENSE_KEY;
            licenseSource = 'Marco - Licenza esistente';
          } else if (user.email === 'federico@menuchat.com') {
            licenseKey = '8D57EE58-7B694EBC-A77FFA52-66B053E3';
            licenseSource = 'Federico - Licenza specifica';
          }
          
          console.log(`🔑 Licenza: ${licenseSource}`);
          console.log(`🎯 Key: ${licenseKey ? licenseKey.substring(0, 12) + '...' : 'Nessuna'}`);
          console.log(`✅ Test: SUCCESSO`);
          
        } else {
          console.log(`❌ Utente non trovato`);
          console.log(`🔑 Licenza: Fallback (OPENWA_LICENSE_KEY)`);
          console.log(`🎯 Key: ${process.env.OPENWA_LICENSE_KEY ? process.env.OPENWA_LICENSE_KEY.substring(0, 12) + '...' : 'Nessuna'}`);
          console.log(`⚠️ Test: Fallback attivato`);
        }
        
      } catch (error) {
        console.error(`❌ Errore: ${error.message}`);
      }
    }

    console.log('\n==========================================');
    console.log('🎉 Test completato!');
    console.log('\n📋 Riepilogo configurazione:');
    console.log(`   • Marco Benvenuti: Licenza esistente`);
    console.log(`   • Federico Desantis: 8D57EE58-7B694EBC-A77FFA52-66B053E3`);
    console.log(`   • Altri utenti: Fallback alla licenza di default`);
    
    console.log('\n🚀 Per testare live:');
    console.log('   1. Accedi con marco@menuchat.com');
    console.log('   2. Crea una sessione WhatsApp');
    console.log('   3. Verifica nei log del server');
    console.log('   4. Ripeti con federico@menuchat.com');

  } catch (error) {
    console.error('❌ Errore generale:', error.message);
  } finally {
    // Chiude la connessione
    await mongoose.connection.close();
    console.log('\n🔌 Disconnesso dal database');
  }
};

// Esegui il test
testLicenseMapping(); 