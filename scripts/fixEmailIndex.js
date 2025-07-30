#!/usr/bin/env node

/**
 * Script per fixare l'indice email rendendolo sparse
 * Permette di avere più contatti con email null/vuota
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';

async function fixEmailIndex() {
  try {
    console.log('🔗 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('contacts');

    console.log('📋 Verifica indici esistenti...');
    const existingIndexes = await collection.indexes();
    console.log('Indici trovati:', existingIndexes.map(idx => idx.name));

    // Trova l'indice email esistente
    const emailIndex = existingIndexes.find(idx => 
      idx.key && idx.key.email === 1
    );

    if (emailIndex) {
      console.log('📧 Indice email trovato:', emailIndex.name);
      
      // Se l'indice non è sparse, lo ricreiamo
      if (!emailIndex.sparse) {
        console.log('🗑️  Rimuovo indice email non-sparse...');
        await collection.dropIndex(emailIndex.name);
        console.log('✅ Indice rimosso');

        console.log('🔧 Creo nuovo indice email sparse...');
        await collection.createIndex(
          { email: 1 }, 
          { 
            unique: true, 
            sparse: true,
            name: 'email_1_sparse'
          }
        );
        console.log('✅ Nuovo indice email sparse creato');
      } else {
        console.log('✅ Indice email già sparse, nessuna azione necessaria');
      }
    } else {
      console.log('🔧 Creo indice email sparse...');
      await collection.createIndex(
        { email: 1 }, 
        { 
          unique: true, 
          sparse: true,
          name: 'email_1_sparse'
        }
      );
      console.log('✅ Indice email sparse creato');
    }

    console.log('🎉 Migrazione completata con successo!');
    console.log('📝 Ora puoi importare contatti senza email');

  } catch (error) {
    console.error('❌ Errore durante la migrazione:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnesso da MongoDB');
    process.exit(0);
  }
}

// Esegui lo script
fixEmailIndex(); 