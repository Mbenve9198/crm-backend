#!/usr/bin/env node

/**
 * Script per testare il sistema Autopilot localmente
 * 
 * Usage:
 * MONGODB_URI="..." SERPER_API_KEY="..." ANTHROPIC_API_KEY="..." node scripts/test-autopilot-local.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import serperService from '../services/serperService.js';
import claudeService from '../services/claudeService.js';
import Contact from '../models/contactModel.js';

// Carica env
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI richiesto');
  process.exit(1);
}

if (!SERPER_API_KEY) {
  console.error('❌ SERPER_API_KEY richiesto');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY richiesto');
  process.exit(1);
}

/**
 * Test completo autopilot su un contatto
 */
async function testAutopilot() {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 TEST AUTOPILOT LOCALE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connetti a MongoDB
    console.log('🔌 Connessione a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso\n');

    // Prendi un contatto di esempio
    const contact = await Contact.findOne({
      'properties.Città': { $exists: true }
    }).limit(1);

    if (!contact) {
      console.error('❌ Nessun contatto trovato con Città');
      return;
    }

    console.log('📋 CONTATTO SELEZIONATO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Nome: ${contact.name}`);
    console.log(`Telefono: ${contact.phone}`);
    console.log(`Properties:`);
    Object.entries(contact.properties || {}).forEach(([key, value]) => {
      console.log(`  - ${key}: ${value}`);
    });
    console.log('');

    // STEP 1: Analisi contesto (include geocoding)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📍 STEP 1: GEOCODING + ANALISI COMPETITOR');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const analysisContext = await serperService.analyzeContactContext(contact);

    if (!analysisContext.hasData) {
      console.error(`❌ Analisi fallita: ${analysisContext.error}`);
      return;
    }

    console.log('\n✅ ANALISI COMPLETATA:');
    console.log(`   Ristorante: ${analysisContext.restaurantName}`);
    console.log(`   Città: ${analysisContext.city}`);
    console.log(`   Coordinate: ${analysisContext.coordinates?.lat}, ${analysisContext.coordinates?.lng}`);
    console.log(`   Ranking: #${analysisContext.userRank}`);
    console.log(`   Reviews: ${analysisContext.userReviews}`);
    console.log(`   Rating: ${analysisContext.userRating}`);
    console.log('');
    console.log('🏆 TOP COMPETITOR:');
    analysisContext.competitors.forEach((comp, idx) => {
      console.log(`   ${idx + 1}. ${comp.name}`);
      console.log(`      Posizione: #${comp.rank}`);
      console.log(`      Reviews: ${comp.reviews}`);
      console.log(`      Rating: ${comp.rating}⭐`);
      console.log(`      Indirizzo: ${comp.address}`);
      console.log('');
    });

    // STEP 2: Genera messaggio con Claude
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 STEP 2: GENERAZIONE MESSAGGIO CON CLAUDE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const settings = {
      tone: 'colloquiale e amichevole',
      maxLength: 280,
      focusPoint: 'visibilità su Google',
      cta: 'offrire tool gratuito'
    };

    const generatedMessage = await claudeService.generateWhatsAppMessage(
      analysisContext,
      settings
    );

    console.log('✅ MESSAGGIO GENERATO:\n');
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log(`│ ${generatedMessage.split('\n').join('\n│ ')}`);
    console.log('└─────────────────────────────────────────────────────────┘\n');

    // STEP 3: Validazione
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✓ STEP 3: VALIDAZIONE MESSAGGIO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const validation = claudeService.validateMessage(generatedMessage);
    
    console.log(`Score: ${validation.score}/100 ${validation.isValid ? '✅' : '❌'}`);
    console.log(`Lunghezza: ${generatedMessage.length} caratteri`);
    if (validation.issues.length > 0) {
      console.log(`Issues: ${validation.issues.join(', ')}`);
    } else {
      console.log(`✅ Nessun problema rilevato`);
    }

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 TEST COMPLETATO CON SUCCESSO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('💰 Costi stimati per questo messaggio:');
    console.log(`   Serper Geocoding: $0.02`);
    console.log(`   Serper Competitor: $0.02`);
    console.log(`   Claude Haiku: $0.001`);
    console.log(`   TOTALE: ~$0.041\n`);

  } catch (error) {
    console.error('❌ Errore test:', error);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnesso da MongoDB');
  }
}

// Run
testAutopilot()
  .then(() => {
    console.log('✅ Test completato!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Errore fatale:', err);
    process.exit(1);
  });


