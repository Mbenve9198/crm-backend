#!/usr/bin/env node

/**
 * Script per ispezionare le properties dei contatti nel CRM
 * Utile per capire quali campi sono disponibili per l'autopilot
 * 
 * Usage:
 * node scripts/inspect-contact-properties.js [lista]
 * 
 * Examples:
 * node scripts/inspect-contact-properties.js
 * node scripts/inspect-contact-properties.js ristoranti-firenze
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';

// Carica env
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI non trovato in .env');
  process.exit(1);
}

/**
 * Analizza properties disponibili nei contatti
 */
async function inspectContactProperties(targetList = null) {
  try {
    // Connetti a MongoDB
    console.log('🔌 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB\n');

    // Costruisci query
    const query = {};
    if (targetList) {
      query.lists = targetList;
    }

    // Conta contatti
    const totalContacts = await Contact.countDocuments(query);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 ANALISI CONTATTI${targetList ? ` - Lista: ${targetList}` : ''}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Totale contatti: ${totalContacts}\n`);

    if (totalContacts === 0) {
      console.log('⚠️  Nessun contatto trovato');
      return;
    }

    // Sample: prendi primi 100 contatti per analisi
    const sampleSize = Math.min(100, totalContacts);
    const contacts = await Contact.find(query)
      .select('name phone email properties lists')
      .limit(sampleSize);

    console.log(`🔍 Campione analizzato: ${contacts.length} contatti\n`);

    // Analizza properties disponibili
    const propertyStats = new Map();
    const propertyExamples = new Map();

    contacts.forEach(contact => {
      if (!contact.properties) return;

      Object.keys(contact.properties).forEach(key => {
        const value = contact.properties[key];
        
        // Conta occorrenze
        if (!propertyStats.has(key)) {
          propertyStats.set(key, {
            count: 0,
            types: new Set(),
            hasNull: false,
            hasEmpty: false,
            sample: null
          });
        }

        const stats = propertyStats.get(key);
        stats.count++;

        // Traccia tipi
        const type = Array.isArray(value) ? 'array' : typeof value;
        stats.types.add(type);

        // Traccia null/empty
        if (value === null) stats.hasNull = true;
        if (value === '') stats.hasEmpty = true;

        // Salva esempio (se non già salvato)
        if (stats.sample === null && value && value !== '') {
          stats.sample = value;
          propertyExamples.set(key, value);
        }
      });
    });

    // Stampa risultati
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 PROPERTIES DISPONIBILI');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Ordina per frequenza
    const sortedProperties = Array.from(propertyStats.entries())
      .sort((a, b) => b[1].count - a[1].count);

    sortedProperties.forEach(([key, stats]) => {
      const percentage = ((stats.count / contacts.length) * 100).toFixed(1);
      const types = Array.from(stats.types).join('|');
      
      console.log(`📌 ${key}`);
      console.log(`   Presente in: ${stats.count}/${contacts.length} contatti (${percentage}%)`);
      console.log(`   Tipo: ${types}`);
      
      if (stats.sample !== null) {
        // Tronca esempi lunghi
        let exampleStr = String(stats.sample);
        if (exampleStr.length > 100) {
          exampleStr = exampleStr.substring(0, 100) + '...';
        }
        console.log(`   Esempio: "${exampleStr}"`);
      }
      
      if (stats.hasNull) console.log(`   ⚠️  Alcuni valori sono null`);
      if (stats.hasEmpty) console.log(`   ⚠️  Alcuni valori sono vuoti`);
      console.log('');
    });

    // Analisi specifica per AUTOPILOT
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 VERIFICA REQUISITI AUTOPILOT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Campi necessari per autopilot (versione geocoding)
    const requiredFields = {
      'restaurant_name': 'Nome ristorante',
      'address': 'Indirizzo completo',
      'city': 'Città',
      'keyword': 'Keyword ricerca (opzionale)'
    };

    Object.entries(requiredFields).forEach(([field, description]) => {
      const stats = propertyStats.get(field);
      
      if (stats) {
        const percentage = ((stats.count / contacts.length) * 100).toFixed(1);
        const status = percentage > 90 ? '✅' : percentage > 50 ? '⚠️' : '❌';
        console.log(`${status} ${field}: ${stats.count}/${contacts.length} (${percentage}%)`);
        console.log(`   ${description}`);
        if (stats.sample) {
          console.log(`   Es: "${stats.sample}"`);
        }
      } else {
        console.log(`❌ ${field}: 0/${contacts.length} (0%)`);
        console.log(`   ${description} - CAMPO MANCANTE`);
      }
      console.log('');
    });

    // Raccomandazioni
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 RACCOMANDAZIONI');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const hasRestaurantName = propertyStats.has('restaurant_name');
    const hasAddress = propertyStats.has('address') || propertyStats.has('indirizzo');
    const hasCity = propertyStats.has('city') || propertyStats.has('citta') || propertyStats.has('città');

    if (hasRestaurantName && (hasAddress || hasCity)) {
      console.log('✅ I contatti hanno i campi necessari per Autopilot con Geocoding!');
      console.log('   Autopilot può usare:');
      if (hasRestaurantName) console.log('   - restaurant_name per cercare il ristorante');
      if (hasAddress) console.log('   - address per il geocoding');
      if (hasCity) console.log('   - city per il geocoding');
    } else {
      console.log('⚠️  ATTENZIONE: Campi mancanti per Autopilot');
      console.log('');
      console.log('Per usare Autopilot con Geocoding, i contatti dovrebbero avere:');
      console.log('  1. properties.restaurant_name (es. "Ristorante Da Mario")');
      console.log('  2. properties.address O properties.city (es. "Via Roma 15, Firenze")');
      console.log('  3. properties.keyword (opzionale, es. "ristorante italiano")');
      console.log('');
      console.log('Alternative disponibili nel database:');
      
      // Suggerisci campi alternativi trovati
      const addressFields = ['address', 'indirizzo', 'via', 'street'];
      const cityFields = ['city', 'citta', 'città', 'comune'];
      const nameFields = ['restaurant_name', 'nome', 'name', 'ristorante'];
      
      console.log('\nCampi indirizzo trovati:');
      addressFields.forEach(field => {
        if (propertyStats.has(field)) {
          const stats = propertyStats.get(field);
          console.log(`  - ${field}: ${stats.count} contatti`);
        }
      });
      
      console.log('\nCampi città trovati:');
      cityFields.forEach(field => {
        if (propertyStats.has(field)) {
          const stats = propertyStats.get(field);
          console.log(`  - ${field}: ${stats.count} contatti`);
        }
      });
      
      console.log('\nCampi nome trovati:');
      nameFields.forEach(field => {
        if (propertyStats.has(field)) {
          const stats = propertyStats.get(field);
          console.log(`  - ${field}: ${stats.count} contatti`);
        }
      });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Errore:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnesso da MongoDB');
  }
}

// Parse arguments
const args = process.argv.slice(2);
const targetList = args[0] || null;

// Run
inspectContactProperties(targetList)
  .then(() => {
    console.log('✅ Analisi completata!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Errore fatale:', err);
    process.exit(1);
  });

