import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per creare il primo utente amministratore
 * Utilizzare dopo l'installazione per avere accesso al sistema
 */

const createAdmin = async () => {
  try {
    // Connessione a MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Verifica se esiste già un admin
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('⚠️  Esiste già un utente admin nel sistema:');
      console.log(`📧 Email: ${existingAdmin.email}`);
      console.log(`👤 Nome: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
      process.exit(0);
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@menuchatcrm.com';
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('❌ Variabile d\'ambiente richiesta: ADMIN_PASSWORD');
      console.error('   Esempio: ADMIN_PASSWORD=LatuaPasswordSicura node scripts/createAdmin.js');
      process.exit(1);
    }

    const adminData = {
      firstName: 'Admin',
      lastName: 'MenuChatCRM',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      department: 'Amministrazione',
      isEmailVerified: true
    };

    const admin = await User.create(adminData);
    
    console.log('🎉 Utente amministratore creato con successo!');
    console.log('');
    console.log(`📧 Email: ${admin.email}`);
    console.log(`👤 Nome: ${admin.firstName} ${admin.lastName}`);
    console.log(`🏢 Ruolo: ${admin.role}`);
    console.log('');
    console.log('⚠️  IMPORTANTE:');
    console.log('   1. Cambia la password dopo il primo login');
    console.log('   2. Aggiorna email e dati personali');
    console.log('   3. Crea altri utenti dal pannello admin');
    console.log('');
    console.log('🚀 Puoi ora effettuare il login su:');
    console.log('   POST /api/auth/login');
    console.log('');

  } catch (error) {
    console.error('❌ Errore nella creazione dell\'admin:', error.message);
    
    if (error.code === 11000) {
      console.log('📧 Un utente con questa email esiste già');
    }
  } finally {
    // Chiude la connessione
    await mongoose.connection.close();
    console.log('📡 Disconnesso da MongoDB');
    process.exit(0);
  }
};

// Gestione parametri da linea di comando
const args = process.argv.slice(2);
const customEmail = args.find(arg => arg.startsWith('--email='))?.split('=')[1];
const customPassword = args.find(arg => arg.startsWith('--password='))?.split('=')[1];
const customName = args.find(arg => arg.startsWith('--name='))?.split('=')[1];

// Script per admin personalizzato
const createCustomAdmin = async () => {
  try {
    if (!customEmail || !customPassword) {
      console.log('❌ Utilizzo: node createAdmin.js --email=EMAIL --password=PASSWORD [--name="Nome Cognome"]');
      process.exit(1);
    }

    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    await mongoose.connect(MONGODB_URI);

    const existingUser = await User.findOne({ email: customEmail });
    if (existingUser) {
      console.log(`❌ Un utente con email ${customEmail} esiste già`);
      process.exit(1);
    }

    const [firstName, ...lastNameParts] = (customName || 'Admin User').split(' ');
    const lastName = lastNameParts.join(' ') || 'MenuChatCRM';

    const admin = await User.create({
      firstName,
      lastName,
      email: customEmail,
      password: customPassword,
      role: 'admin',
      department: 'Amministrazione',
      isEmailVerified: true
    });

    console.log('🎉 Admin personalizzato creato con successo!');
    console.log(`📧 Email: ${admin.email}`);
    console.log(`👤 Nome: ${admin.firstName} ${admin.lastName}`);

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Esegue lo script appropriato
if (customEmail) {
  createCustomAdmin();
} else {
  createAdmin();
}

/**
 * ISTRUZIONI D'USO:
 * 
 * 1. Admin di default (richiede ADMIN_PASSWORD come variabile d'ambiente):
 *    ADMIN_PASSWORD=xxx node scripts/createAdmin.js
 * 
 * 2. Admin personalizzato:
 *    node scripts/createAdmin.js --email=admin@tuazienda.com --password=xxx --name="Mario Rossi"
 * 
 * 3. Verifica esistenza admin:
 *    Il script controlla automaticamente se esiste già un admin
 */ 