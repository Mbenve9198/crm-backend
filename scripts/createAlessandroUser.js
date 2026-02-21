import mongoose from 'mongoose';
import User from '../models/userModel.js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente dal file .env
dotenv.config({ path: './.env' });

/**
 * Script per creare l'utente Alessandro Totti con configurazione Twilio
 */

const createAlessandroUser = async () => {
  try {
    // Connessione al database di produzione
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    
    console.log('🚀 Connessione al database...');
    console.log('📍 URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'));
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connesso al database!\n');
    
    // Verifica se l'utente esiste già
    const existingUser = await User.findOne({ email: 'alessandro.totti@menuchat.it' });
    
    if (existingUser) {
      console.log('⚠️  L\'utente alessandro.totti@menuchat.it esiste già!');
      console.log(`   👤 Nome: ${existingUser.firstName} ${existingUser.lastName}`);
      console.log(`   🏢 Ruolo: ${existingUser.role}`);
      console.log(`   📞 Numero Twilio: ${existingUser.settings?.twilio?.phoneNumber || 'Non configurato'}`);
      console.log('\n💡 Vuoi aggiornare la configurazione? Modifica lo script per usare findOneAndUpdate\n');
      await mongoose.disconnect();
      return;
    }
    
    if (!process.env.ALESSANDRO_PASSWORD) {
      console.error('❌ Variabile d\'ambiente richiesta: ALESSANDRO_PASSWORD');
      process.exit(1);
    }

    console.log('🔧 Creazione nuovo utente Alessandro Totti...\n');
    
    // Numero di telefono Twilio in formato E.164
    const twilioPhoneNumber = '+393737683347';
    
    // Dati del nuovo utente con configurazione Twilio completa
    const userData = {
      firstName: 'Alessandro',
      lastName: 'Totti',
      email: 'alessandro.totti@menuchat.it',
      password: process.env.ALESSANDRO_PASSWORD,
      role: 'admin', // Tutti i permessi
      department: 'Amministrazione',
      isEmailVerified: true,
      isActive: true,
      settings: {
        language: 'it',
        timezone: 'Europe/Rome',
        notifications: {
          email: true,
          push: true,
          newContacts: true,
          assignedContacts: true
        },
        tablePreferences: {
          contacts: {
            visibleColumns: ['Contact', 'Email', 'Phone', 'Owner', 'Lists', 'Created', 'Actions'],
            pageSize: 10
          }
        },
        twilio: {
          phoneNumber: twilioPhoneNumber,
          isVerified: true, // Già verificato
          isEnabled: true, // Già abilitato
          lastVerified: new Date()
        },
        whatsappTemplate: {
          message: 'Ciao {nome}, sono {utente} di MenuChat. Come posso aiutarti?',
          variables: ['nome', 'utente'],
          updatedAt: new Date()
        }
      },
      stats: {
        totalContacts: 0,
        contactsThisMonth: 0,
        loginCount: 0
      }
    };
    
    // Crea l'utente
    const newUser = await User.create(userData);
    
    console.log('✅ ═══════════════════════════════════════════════════');
    console.log('✅ UTENTE CREATO CON SUCCESSO!');
    console.log('✅ ═══════════════════════════════════════════════════\n');
    
    console.log('👤 INFORMAZIONI UTENTE:');
    console.log('   Nome Completo: ' + newUser.fullName);
    console.log('   Email: ' + newUser.email);
    console.log('   Password: [impostata tramite env]');
    console.log('   Ruolo: ' + newUser.role + ' (TUTTI I PERMESSI)');
    console.log('   Dipartimento: ' + newUser.department);
    console.log('   Account Attivo: ' + (newUser.isActive ? '✅ Sì' : '❌ No'));
    console.log('   Email Verificata: ' + (newUser.isEmailVerified ? '✅ Sì' : '❌ No'));
    
    console.log('\n📞 CONFIGURAZIONE TWILIO:');
    console.log('   Numero Telefono: ' + twilioPhoneNumber);
    console.log('   Stato: ✅ Verificato e Abilitato');
    console.log('   Data Verifica: ' + newUser.settings.twilio.lastVerified.toLocaleString('it-IT'));
    
    console.log('\n🚀 ACCESSO AL SISTEMA:');
    console.log('   Frontend URL: ' + (process.env.FRONTEND_URL || 'crm-frontend-pied-sigma.vercel.app'));
    console.log('   Backend URL: ' + (process.env.BACKEND_URL || 'https://menuchat-crm-backend-production.up.railway.app'));
    console.log('   Endpoint Login: POST /api/auth/login');
    
    console.log('\n🎯 PERMESSI ADMIN:');
    console.log('   ✅ Gestione completa utenti');
    console.log('   ✅ Gestione completa contatti');
    console.log('   ✅ Configurazione sistema');
    console.log('   ✅ Accesso a tutti i dati');
    console.log('   ✅ Chiamate Twilio abilitate');
    console.log('   ✅ Campagne WhatsApp');
    
    // Statistiche finali
    const totalUsers = await User.countDocuments();
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    console.log('\n📈 STATISTICHE DATABASE:');
    console.log('   Totale Utenti: ' + totalUsers);
    console.log('   Amministratori: ' + adminCount);
    
    console.log('\n✅ ═══════════════════════════════════════════════════');
    console.log('✅ CONFIGURAZIONE COMPLETATA!');
    console.log('✅ ═══════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ ═══════════════════════════════════════════════════');
    console.error('❌ ERRORE DURANTE LA CREAZIONE DELL\'UTENTE');
    console.error('❌ ═══════════════════════════════════════════════════\n');
    console.error('Dettagli errore:', error.message);
    
    if (error.code === 11000) {
      console.error('\n⚠️  Email già esistente nel database');
    } else if (error.name === 'ValidationError') {
      console.error('\n⚠️  Errore di validazione:');
      Object.keys(error.errors).forEach(key => {
        console.error('   - ' + key + ': ' + error.errors[key].message);
      });
    }
    
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnesso dal database\n');
  }
};

// Esegui lo script
createAlessandroUser();
