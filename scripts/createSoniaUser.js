import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './crm.env' });

const EMAIL = 'sonia@menuchat.it';

const createSoniaUser = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    const password = process.env.SONIA_PASSWORD;

    if (!password) {
      console.error('❌ Variabile d\'ambiente richiesta: SONIA_PASSWORD');
      process.exit(1);
    }

    console.log('🚀 Connessione al database...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso al database!\n');

    const existingUser = await User.findOne({ email: EMAIL });
    if (existingUser) {
      console.log(`⚠️  L'utente ${EMAIL} esiste già`);
      console.log(`   👤 Nome: ${existingUser.firstName} ${existingUser.lastName}`);
      console.log(`   🏢 Ruolo: ${existingUser.role}`);
      await mongoose.disconnect();
      return;
    }

    const userData = {
      firstName: 'Sonia',
      lastName: 'MenuChat',
      email: EMAIL,
      password,
      role: 'agent',
      department: 'Sales',
      isEmailVerified: true,
      isActive: true,
      settings: {
        language: 'it',
        timezone: 'Europe/Rome',
        notifications: {
          email: true,
          push: true,
          newContacts: true,
          assignedContacts: true,
        },
        tablePreferences: {
          contacts: {
            visibleColumns: ['Contact', 'Email', 'Phone', 'Owner', 'Lists', 'Created', 'Actions'],
            pageSize: 10,
          },
        },
      },
      stats: {
        totalContacts: 0,
        contactsThisMonth: 0,
        loginCount: 0,
      },
    };

    const newUser = await User.create(userData);

    console.log('✅ Utente creato con successo');
    console.log(`   👤 ${newUser.fullName}`);
    console.log(`   📧 ${newUser.email}`);
    console.log(`   🏢 Ruolo: ${newUser.role}`);
    console.log(`   📂 Dipartimento: ${newUser.department}`);
    console.log(`   🆔 ID: ${newUser._id}`);
  } catch (error) {
    console.error('❌ Errore:', error.message);
    if (error.code === 11000) {
      console.error('   Email già esistente');
    }
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnesso dal database');
  }
};

createSoniaUser();
