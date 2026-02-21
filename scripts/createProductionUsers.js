import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

const createProductionUsers = async () => {
  try {
    // Usa la MONGODB_URI di produzione
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    
    console.log('🚀 Connessione al database di produzione...');
    console.log('📍 URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')); // Nasconde le credenziali
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connesso al database di produzione!');
    
    // Verifica se gli utenti esistono già
    const existingMarco = await User.findOne({ email: 'marco@menuchat.com' });
    const existingFederico = await User.findOne({ email: 'federico@menuchat.com' });
    
    console.log('\n📊 Stato utenti attuali:');
    console.log('Marco:', existingMarco ? '✅ Esiste' : '❌ Non esiste');
    console.log('Federico:', existingFederico ? '✅ Esiste' : '❌ Non esiste');
    
    if (!process.env.ADMIN_PASSWORD || !process.env.MANAGER_PASSWORD) {
      console.error('❌ Variabili d\'ambiente richieste: ADMIN_PASSWORD, MANAGER_PASSWORD');
      process.exit(1);
    }

    const usersToCreate = [];
    
    if (!existingMarco) {
      usersToCreate.push({
        firstName: 'Marco',
        lastName: 'Benvenuti',
        email: 'marco@menuchat.com',
        password: process.env.ADMIN_PASSWORD,
        role: 'admin',
        department: 'Amministrazione',
        isEmailVerified: true,
        isActive: true
      });
    }
    
    if (!existingFederico) {
      usersToCreate.push({
        firstName: 'Federico',
        lastName: 'MenuChat',
        email: 'federico@menuchat.com',
        password: process.env.MANAGER_PASSWORD,
        role: 'manager',
        department: 'Gestione',
        isEmailVerified: true,
        isActive: true
      });
    }
    
    if (usersToCreate.length === 0) {
      console.log('\n🎉 Tutti gli utenti esistono già!');
      return;
    }
    
    console.log(`\n🔧 Creazione di ${usersToCreate.length} utenti...`);
    
    for (const userData of usersToCreate) {
      try {
        const user = new User(userData);
        await user.save();
        console.log(`✅ Utente creato: ${userData.email} (${userData.role})`);
      } catch (error) {
        console.error(`❌ Errore creazione ${userData.email}:`, error.message);
      }
    }
    
    // Mostra statistiche finali
    const totalUsers = await User.countDocuments();
    const adminCount = await User.countDocuments({ role: 'admin' });
    const managerCount = await User.countDocuments({ role: 'manager' });
    
    console.log('\n📈 Statistiche finali:');
    console.log(`👥 Totale utenti: ${totalUsers}`);
    console.log(`👑 Amministratori: ${adminCount}`);
    console.log(`📋 Manager: ${managerCount}`);
    
    console.log('\n🎯 Utenti creati. Le credenziali sono quelle impostate tramite variabili d\'ambiente.');
    
  } catch (error) {
    console.error('❌ Errore durante la creazione degli utenti:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnesso dal database');
  }
};

// Esegui lo script
createProductionUsers(); 