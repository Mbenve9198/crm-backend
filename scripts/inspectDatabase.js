#!/usr/bin/env node

/**
 * Script per ispezionare la struttura dei contatti nel database
 * Mostra tutte le proprietà dinamiche presenti
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from '../models/contactModel.js';

// Carica le variabili d'ambiente
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';

async function inspectDatabase() {
  try {
    console.log('🔗 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    console.log('\n📊 ANALISI CONTATTI NEL DATABASE\n');

    // Conta totale contatti
    const totalContacts = await Contact.countDocuments();
    console.log(`📈 Totale contatti: ${totalContacts}`);

    // Prendi tutti i contatti per analizzare le proprietà
    const contacts = await Contact.find({}).limit(100); // Limitiamo a 100 per performance
    console.log(`🔍 Analizzando primi ${contacts.length} contatti...\n`);

    // Raccogli tutte le proprietà dinamiche
    const allProperties = new Set();
    const propertyStats = {};

    contacts.forEach((contact, index) => {
      console.log(`\n--- CONTATTO ${index + 1} ---`);
      console.log(`Nome: ${contact.name}`);
      console.log(`Email: ${contact.email || 'N/A'}`);
      console.log(`Phone: ${contact.phone || 'N/A'}`);
      console.log(`Liste: ${contact.lists ? contact.lists.join(', ') : 'Nessuna'}`);
      
      if (contact.properties && typeof contact.properties === 'object') {
        console.log('Proprietà dinamiche:');
        Object.keys(contact.properties).forEach(key => {
          const value = contact.properties[key];
          console.log(`  - ${key}: ${value} (${typeof value})`);
          
          // Raccogli statistiche
          allProperties.add(key);
          if (!propertyStats[key]) {
            propertyStats[key] = { count: 0, examples: new Set() };
          }
          propertyStats[key].count++;
          if (propertyStats[key].examples.size < 3) {
            propertyStats[key].examples.add(String(value));
          }
        });
      } else {
        console.log('Proprietà dinamiche: Nessuna');
      }
    });

    console.log('\n🏷️  RIEPILOGO PROPRIETÀ DINAMICHE TROVATE:\n');
    
    if (allProperties.size === 0) {
      console.log('❌ Nessuna proprietà dinamica trovata nei contatti');
    } else {
      console.log(`✅ Trovate ${allProperties.size} proprietà dinamiche uniche:\n`);
      
      Array.from(allProperties).sort().forEach(prop => {
        const stats = propertyStats[prop];
        const examples = Array.from(stats.examples).slice(0, 3).join(', ');
        console.log(`📋 ${prop}:`);
        console.log(`   - Presente in ${stats.count}/${contacts.length} contatti`);
        console.log(`   - Esempi: ${examples}`);
        console.log('');
      });
    }

    console.log('\n🔍 STRUTTURA SCHEMA MONGOOSE:\n');
    const schema = Contact.schema;
    console.log('Campi base definiti nello schema:');
    Object.keys(schema.paths).forEach(path => {
      if (path !== '__v' && path !== '_id') {
        const field = schema.paths[path];
        console.log(`  - ${path}: ${field.instance} ${field.isRequired ? '(obbligatorio)' : '(opzionale)'}`);
      }
    });

  } catch (error) {
    console.error('❌ Errore durante l\'ispezione:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnesso da MongoDB');
    process.exit(0);
  }
}

// Esegui lo script
inspectDatabase(); 