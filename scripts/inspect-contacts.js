#!/usr/bin/env node

/**
 * Script per ispezionare la struttura dei contatti nel database
 * Trova tutti i campi properties usati nei contatti
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';

dotenv.config();

async function inspectContacts() {
  try {
    // Connetti al database
    const MONGODB_URI = process.env.MONGODB_URI;
    
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI non trovato in .env');
      process.exit(1);
    }

    console.log('🔌 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso!\n');

    // Conta totale contatti
    const totalContacts = await Contact.countDocuments();
    console.log(`📊 Totale contatti: ${totalContacts}\n`);

    // Prendi 5 contatti di esempio con telefono
    const sampleContacts = await Contact.find({ 
      phone: { $exists: true, $ne: null, $ne: '' } 
    }).limit(5);

    console.log('===== 5 CONTATTI DI ESEMPIO =====\n');
    
    sampleContacts.forEach((contact, idx) => {
      console.log(`--- Contatto ${idx + 1} ---`);
      console.log(`Name: ${contact.name}`);
      console.log(`Phone: ${contact.phone}`);
      console.log(`Email: ${contact.email || 'N/A'}`);
      console.log(`Source: ${contact.source}`);
      
      if (contact.properties && Object.keys(contact.properties).length > 0) {
        console.log(`Properties:`, JSON.stringify(contact.properties, null, 2));
      } else {
        console.log(`Properties: (vuoto)`);
      }
      
      if (contact.rankCheckerData) {
        console.log(`RankCheckerData:`, JSON.stringify(contact.rankCheckerData, null, 2));
      }
      
      console.log('');
    });

    // Aggrega tutti i campi properties usati
    console.log('\n===== CAMPI PROPERTIES USATI (primi 50) =====\n');
    
    const propertyKeys = await Contact.aggregate([
      { $match: { properties: { $exists: true, $ne: null } } },
      { $project: { 
        keys: { $objectToArray: '$properties' } 
      }},
      { $unwind: '$keys' },
      { $group: { 
        _id: '$keys.k',
        count: { $sum: 1 },
        sampleValue: { $first: '$keys.v' }
      }},
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]);

    propertyKeys.forEach(prop => {
      const sampleStr = typeof prop.sampleValue === 'object' 
        ? JSON.stringify(prop.sampleValue) 
        : String(prop.sampleValue);
      console.log(`• ${prop._id} (${prop.count} contatti) - esempio: ${sampleStr.substring(0, 60)}`);
    });

    // Conta contatti per source
    console.log('\n===== CONTATTI PER SOURCE =====\n');
    const bySource = await Contact.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    bySource.forEach(s => {
      console.log(`${s._id}: ${s.count} contatti`);
    });

    // Contatti con rankCheckerData
    const withRankData = await Contact.countDocuments({ 
      'rankCheckerData.restaurantData.coordinates': { $exists: true } 
    });
    console.log(`\n📍 Contatti con coordinate in rankCheckerData: ${withRankData}`);

    // Contatti con properties.latitude
    const withLatLng = await Contact.countDocuments({ 
      'properties.latitude': { $exists: true },
      'properties.longitude': { $exists: true }
    });
    console.log(`📍 Contatti con latitude/longitude in properties: ${withLatLng}`);

    // Cerca campi comuni per indirizzo
    const addressFields = await Contact.aggregate([
      { $match: { properties: { $exists: true } } },
      { $project: {
        hasAddress: { $ifNull: ['$properties.address', null] },
        hasIndirizzo: { $ifNull: ['$properties.indirizzo', null] },
        hasCity: { $ifNull: ['$properties.city', null] },
        hasCitta: { $ifNull: ['$properties.città', null] }
      }},
      { $group: {
        _id: null,
        address: { $sum: { $cond: [{ $ne: ['$hasAddress', null] }, 1, 0] } },
        indirizzo: { $sum: { $cond: [{ $ne: ['$hasIndirizzo', null] }, 1, 0] } },
        city: { $sum: { $cond: [{ $ne: ['$hasCity', null] }, 1, 0] } },
        città: { $sum: { $cond: [{ $ne: ['$hasCitta', null] }, 1, 0] } }
      }}
    ]);

    console.log(`\n===== CAMPI INDIRIZZO =====`);
    if (addressFields[0]) {
      console.log(`properties.address: ${addressFields[0].address} contatti`);
      console.log(`properties.indirizzo: ${addressFields[0].indirizzo} contatti`);
      console.log(`properties.city: ${addressFields[0].city} contatti`);
      console.log(`properties.città: ${addressFields[0].città} contatti`);
    }

    console.log('\n✅ Ispezione completata!\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Errore:', error);
    process.exit(1);
  }
}

inspectContacts();

