import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './crm.env' });

/**
 * Crea gli utenti Gianfranco Airini e Giusy Barbieri con numero Twilio per le chiamate.
 *
 * Env richieste:
 *   GIANFRANCO_PASSWORD
 *   GIUSY_PASSWORD
 * Opzionali (copiate nelle settings Twilio se presenti):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */

const USERS = [
  {
    firstName: 'Gianfranco',
    lastName: 'Airini',
    email: 'gianfryairini@gmail.com',
    passwordEnv: 'GIANFRANCO_PASSWORD',
    twilioPhoneNumber: '+393338588660',
  },
  {
    firstName: 'Giusy',
    lastName: 'Barbieri',
    email: 'gbarbieri944@gmail.com',
    passwordEnv: 'GIUSY_PASSWORD',
    twilioPhoneNumber: '+393517183811',
  },
];

const buildUserData = ({ firstName, lastName, email, password, twilioPhoneNumber }) => {
  const twilio = {
    phoneNumber: twilioPhoneNumber,
    isVerified: true,
    isEnabled: true,
    lastVerified: new Date(),
  };

  if (process.env.TWILIO_ACCOUNT_SID) {
    twilio.accountSid = process.env.TWILIO_ACCOUNT_SID;
  }
  if (process.env.TWILIO_AUTH_TOKEN) {
    twilio.authToken = process.env.TWILIO_AUTH_TOKEN;
  }

  return {
    firstName,
    lastName,
    email,
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
      twilio,
      whatsappTemplate: {
        message: 'Ciao {nome}, sono {utente} di Menu Chat. Come posso aiutarti?',
        variables: ['nome', 'utente'],
        updatedAt: new Date(),
      },
    },
    stats: {
      totalContacts: 0,
      contactsThisMonth: 0,
      loginCount: 0,
    },
  };
};

const createUsers = async () => {
  try {
    for (const u of USERS) {
      if (!process.env[u.passwordEnv]) {
        console.error(`❌ Variabile d'ambiente richiesta: ${u.passwordEnv}`);
        process.exit(1);
      }
    }

    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/crm';
    console.log('🚀 Connessione al database...');
    console.log('📍 URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'));
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso!\n');

    for (const u of USERS) {
      const existing = await User.findOne({ email: u.email });
      if (existing) {
        console.log(`⚠️  Già esistente: ${u.email}`);
        console.log(`   👤 ${existing.firstName} ${existing.lastName}`);
        console.log(`   🏢 ${existing.role}`);
        console.log(`   📞 ${existing.settings?.twilio?.phoneNumber || 'n/d'}`);
        console.log('');
        continue;
      }

      const newUser = await User.create(
        buildUserData({
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          password: process.env[u.passwordEnv],
          twilioPhoneNumber: u.twilioPhoneNumber,
        })
      );

      console.log('✅ Creato');
      console.log(`   👤 ${newUser.fullName}`);
      console.log(`   📧 ${newUser.email}`);
      console.log(`   🏢 ${newUser.role} / ${newUser.department}`);
      console.log(`   📞 Twilio: ${newUser.settings.twilio.phoneNumber}`);
      console.log(`   🆔 ${newUser._id}`);
      console.log('');
    }
  } catch (error) {
    console.error('❌ Errore:', error.message);
    if (error.code === 11000) {
      console.error('   Email già esistente');
    }
    if (error.name === 'ValidationError') {
      Object.keys(error.errors || {}).forEach((key) => {
        console.error(`   - ${key}: ${error.errors[key].message}`);
      });
    }
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnesso');
  }
};

createUsers();
