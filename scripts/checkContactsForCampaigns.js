/**
 * Script di Diagnostica Contatti per Campagne WhatsApp
 * 
 * Verifica perché i contatti non vengono trovati quando si creano campagne
 * 
 * Utilizzo:
 * node scripts/checkContactsForCampaigns.js
 */

import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import { config } from 'dotenv';

// Carica variabili ambiente
config();

async function checkContactsForCampaigns() {
  console.log('🔍 Avvio diagnostica contatti per campagne WhatsApp...\n');

  try {
    // Connetti a MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // 1. Conta tutti i contatti
    const totalContacts = await Contact.countDocuments();
    console.log(`\n📊 TOTALE CONTATTI: ${totalContacts}`);

    if (totalContacts === 0) {
      console.log('❌ Nessun contatto trovato nel database!');
      return;
    }

    // 2. Analizza i campi phone
    console.log('\n📱 ANALISI CAMPI TELEFONO:');
    
    const withPhone = await Contact.countDocuments({ 
      phone: { $exists: true, $ne: null, $ne: '' } 
    });
    
    const withoutPhone = await Contact.countDocuments({ 
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });

    console.log(`   ✅ Con telefono valido: ${withPhone}`);
    console.log(`   ❌ Senza telefono: ${withoutPhone}`);

    // 3. Mostra esempi di contatti senza telefono
    if (withoutPhone > 0) {
      console.log('\n🔍 ESEMPI CONTATTI SENZA TELEFONO (primi 5):');
      const contactsWithoutPhone = await Contact.find({
        $or: [
          { phone: { $exists: false } },
          { phone: null },
          { phone: '' }
        ]
      }).limit(5).select('name email phone lists properties');

      contactsWithoutPhone.forEach((contact, index) => {
        console.log(`   ${index + 1}. Nome: ${contact.name || 'N/A'}`);
        console.log(`      Email: ${contact.email || 'N/A'}`);
        console.log(`      Phone: ${contact.phone || 'VUOTO'}`);
        console.log(`      Liste: ${contact.lists?.join(', ') || 'Nessuna'}`);
        console.log('');
      });
    }

    // 4. Analizza per owner
    console.log('👥 ANALISI PER OWNER:');
    const contactsByOwner = await Contact.aggregate([
      {
        $group: {
          _id: '$owner',
          total: { $sum: 1 },
          withPhone: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ne: ['$phone', null] },
                    { $ne: ['$phone', ''] },
                    { $exists: '$phone' }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'ownerInfo'
        }
      }
    ]);

    contactsByOwner.forEach(owner => {
      const ownerName = owner.ownerInfo[0] 
        ? `${owner.ownerInfo[0].firstName} ${owner.ownerInfo[0].lastName}` 
        : `ID: ${owner._id}`;
      
      console.log(`   👤 ${ownerName}`);
      console.log(`      Totale: ${owner.total}, Con telefono: ${owner.withPhone}`);
    });

    // 5. Analizza per liste
    console.log('\n📋 ANALISI PER LISTE:');
    const contactsByList = await Contact.aggregate([
      { $unwind: { path: '$lists', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$lists',
          total: { $sum: 1 },
          withPhone: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ne: ['$phone', null] },
                    { $ne: ['$phone', ''] },
                    { $exists: '$phone' }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { total: -1 } }
    ]);

    contactsByList.forEach(list => {
      const listName = list._id || 'Senza lista';
      console.log(`   📋 ${listName}`);
      console.log(`      Totale: ${list.total}, Con telefono: ${list.withPhone}`);
    });

    // 6. Simula filtro campagna tipico
    console.log('\n🎯 SIMULAZIONE FILTRO CAMPAGNA:');
    
    // Trova il primo owner con contatti
    const firstOwnerWithContacts = contactsByOwner.find(o => o.total > 0);
    
    if (firstOwnerWithContacts) {
      const testFilter = { 
        owner: firstOwnerWithContacts._id,
        phone: { $exists: true, $ne: null, $ne: '' }
      };
      
      const contactsForCampaign = await Contact.find(testFilter).select('name phone email lists');
      
      console.log(`   🧪 Test per owner ${firstOwnerWithContacts._id}:`);
      console.log(`   📞 Contatti con telefono: ${contactsForCampaign.length}`);
      
      if (contactsForCampaign.length > 0) {
        console.log('\n✅ ESEMPIO CONTATTI VALIDI PER CAMPAGNA (primi 3):');
        contactsForCampaign.slice(0, 3).forEach((contact, index) => {
          console.log(`   ${index + 1}. ${contact.name}: ${contact.phone}`);
        });
      } else {
        console.log('❌ NESSUN CONTATTO VALIDO TROVATO PER QUESTO OWNER');
      }
    }

    // 7. Suggerimenti per la risoluzione
    console.log('\n💡 SUGGERIMENTI:');
    
    if (withoutPhone > 0) {
      console.log('   📱 Molti contatti non hanno numero di telefono.');
      console.log('   🔧 Soluzioni:');
      console.log('      1. Importa/aggiorna i contatti con numeri di telefono');
      console.log('      2. Aggiungi manualmente i numeri mancanti');
      console.log('      3. Usa liste che contengono contatti con telefono');
    }
    
    if (withPhone > 0) {
      console.log(`   ✅ Hai ${withPhone} contatti con telefono disponibili.`);
      console.log('   💡 Assicurati di:');
      console.log('      1. Selezionare la lista giusta');
      console.log('      2. Verificare che i contatti appartengano al tuo utente');
      console.log('      3. Non applicare filtri troppo restrittivi');
    }

    console.log('\n✅ Diagnostica completata');

  } catch (error) {
    console.error('❌ Errore durante la diagnostica:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnesso da MongoDB');
  }
}

// Esegui solo se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
  checkContactsForCampaigns().catch(console.error);
}

export default checkContactsForCampaigns; 