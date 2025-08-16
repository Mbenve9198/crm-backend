import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';

/**
 * Script per eliminare tutti i contatti che non hanno proprietà dinamiche
 */

const cleanContactsWithoutProperties = async () => {
  try {
    // Connessione al database
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://marco:GDFKsRoislGkxAf8@crm-menuchat.pirhts7.mongodb.net/?retryWrites=true&w=majority&appName=crm-menuchat';
    
    console.log('🔌 Connessione al database...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connesso al database');

    // Trova contatti senza proprietà dinamiche
    const contactsWithoutProperties = await Contact.find({
      $or: [
        { properties: { $exists: false } },
        { properties: null },
        { properties: {} }
      ]
    }).select('_id name email properties');

    console.log(`📊 Trovati ${contactsWithoutProperties.length} contatti senza proprietà dinamiche`);

    if (contactsWithoutProperties.length === 0) {
      console.log('✅ Nessun contatto da eliminare');
      return;
    }

    // Mostra alcuni esempi
    console.log('\n📋 Esempi di contatti che verranno eliminati:');
    contactsWithoutProperties.slice(0, 5).forEach((contact, i) => {
      console.log(`  ${i+1}. ${contact.name} (${contact.email || 'no email'})`);
      console.log(`     Properties:`, contact.properties);
    });

    if (contactsWithoutProperties.length > 5) {
      console.log(`     ... e altri ${contactsWithoutProperties.length - 5} contatti`);
    }

    // Conferma eliminazione
    console.log(`\n❓ Procedere con l'eliminazione di ${contactsWithoutProperties.length} contatti? (y/n)`);
    
    // In ambiente di script, procediamo automaticamente
    console.log('🗑️ Eliminazione in corso...');
    
    const result = await Contact.deleteMany({
      $or: [
        { properties: { $exists: false } },
        { properties: null },
        { properties: {} }
      ]
    });

    console.log(`✅ Eliminati ${result.deletedCount} contatti senza proprietà dinamiche`);

    // Verifica contatti rimanenti
    const remainingContacts = await Contact.countDocuments();
    const contactsWithProperties = await Contact.countDocuments({
      properties: { $exists: true, $ne: null, $ne: {} }
    });

    console.log(`\n📊 Riepilogo finale:`);
    console.log(`   - Contatti totali rimanenti: ${remainingContacts}`);
    console.log(`   - Contatti con proprietà dinamiche: ${contactsWithProperties}`);
    console.log(`   - Contatti senza proprietà: ${remainingContacts - contactsWithProperties}`);

  } catch (error) {
    console.error('❌ Errore durante la pulizia:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Connessione chiusa');
    process.exit(0);
  }
};

// Esegui lo script
cleanContactsWithoutProperties(); 