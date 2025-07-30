import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per creare gli utenti Marco e Federico
 */

const createUsers = async () => {
  try {
    // Connessione a MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Definisco gli utenti da creare
    const usersToCreate = [
      {
        firstName: 'Marco',
        lastName: 'Benvenuti',
        email: 'marco@menuchat.com',
        password: 'Itpennywise9194!',
        role: 'admin', // Assumo che Marco sia admin
        department: 'Amministrazione',
        isEmailVerified: true
      },
      {
        firstName: 'Federico',
        lastName: 'MenuChat',
        email: 'federico@menuchat.com',
        password: 'Itpennywise9194!',
        role: 'manager', // Assumo che Federico sia manager
        department: 'Gestione',
        isEmailVerified: true
      }
    ];

    console.log('👥 Creazione utenti in corso...\n');

    for (const userData of usersToCreate) {
      try {
        // Verifica se l'utente esiste già
        const existingUser = await User.findOne({ email: userData.email });
        
        if (existingUser) {
          console.log(`⚠️  L'utente ${userData.email} esiste già`);
          console.log(`   👤 Nome: ${existingUser.firstName} ${existingUser.lastName}`);
          console.log(`   🏢 Ruolo: ${existingUser.role}\n`);
          continue;
        }

        // Crea il nuovo utente
        const newUser = await User.create(userData);
        
        console.log(`✅ Utente creato: ${userData.email}`);
        console.log(`   👤 Nome: ${newUser.firstName} ${newUser.lastName}`);
        console.log(`   🏢 Ruolo: ${newUser.role}`);
        console.log(`   🏢 Dipartimento: ${newUser.department}`);
        console.log(`   🔑 Password: ${userData.password}\n`);
        
      } catch (error) {
        console.error(`❌ Errore nella creazione di ${userData.email}:`, error.message);
        if (error.code === 11000) {
          console.log(`   📧 Email già esistente\n`);
        }
      }
    }

    console.log('🎉 Processo di creazione utenti completato!');
    console.log('\n📋 RIEPILOGO CREDENZIALI:');
    console.log('================================');
    console.log('👤 Marco Benvenuti');
    console.log('   📧 Email: marco@menuchat.com');
    console.log('   🔑 Password: Itpennywise9194!');
    console.log('   🏢 Ruolo: admin');
    console.log('');
    console.log('👤 Federico MenuChat');
    console.log('   📧 Email: federico@menuchat.com');
    console.log('   🔑 Password: Itpennywise9194!');
    console.log('   🏢 Ruolo: manager');
    console.log('\n🚀 Entrambi possono effettuare il login su:');
    console.log('   POST /api/auth/login');

  } catch (error) {
    console.error('❌ Errore generale:', error.message);
  } finally {
    // Chiude la connessione
    await mongoose.connection.close();
    console.log('\n📡 Disconnesso da MongoDB');
    process.exit(0);
  }
};

// Esegue lo script
createUsers(); 