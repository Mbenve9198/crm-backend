#!/usr/bin/env node

/**
 * Script per testare il sistema Autopilot con messageStyle='case-study'
 * 
 * Usage:
 * MONGODB_URI="..." SERPER_API_KEY="..." ANTHROPIC_API_KEY="..." node scripts/test-autopilot-casestudy.js
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

if (!MONGODB_URI || !SERPER_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ MONGODB_URI, SERPER_API_KEY e ANTHROPIC_API_KEY richiesti');
  process.exit(1);
}

async function testCaseStudyStyle() {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 TEST AUTOPILOT - CASE STUDY STYLE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connetti a MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB\n');

    // Prendi un contatto
    const contact = await Contact.findOne({
      'properties.Città': { $exists: true }
    }).limit(1);

    if (!contact) {
      console.error('❌ Nessun contatto trovato');
      return;
    }

    console.log(`📋 Contatto: ${contact.name} (${contact.properties?.Città})\n`);

    // Analisi contesto
    console.log('📍 Analisi competitor...');
    const analysisContext = await serperService.analyzeContactContext(contact);

    if (!analysisContext.hasData) {
      console.error(`❌ Analisi fallita: ${analysisContext.error}`);
      return;
    }

    console.log(`✅ Competitor trovati: ${analysisContext.competitors.length}`);
    console.log(`   Ranking: #${analysisContext.userRank}\n`);

    // Test ENTRAMBI gli stili
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 STYLE 1: DIRECT (Tool Gratuito)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const directMessage = await claudeService.generateWhatsAppMessage(
      analysisContext,
      {
        messageStyle: 'direct',
        tone: 'colloquiale e amichevole',
        maxLength: 350
      }
    );

    console.log('MESSAGGIO GENERATO:\n');
    console.log('┌' + '─'.repeat(70) + '┐');
    console.log(`│ ${directMessage.replace(/\n/g, '\n│ ')}`);
    console.log('└' + '─'.repeat(70) + '┘');
    console.log(`\nLunghezza: ${directMessage.length} caratteri\n`);

    // Pausa
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 STYLE 2: CASE STUDY (Il Porto di Livorno)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const caseStudyMessage = await claudeService.generateWhatsAppMessage(
      analysisContext,
      {
        messageStyle: 'case-study',
        tone: 'colloquiale e amichevole',
        maxLength: 500 // Più lungo per case study
      }
    );

    console.log('MESSAGGIO GENERATO:\n');
    console.log('┌' + '─'.repeat(70) + '┐');
    const lines = caseStudyMessage.split('\n');
    lines.forEach(line => {
      console.log(`│ ${line}${' '.repeat(Math.max(0, 69 - line.length))}│`);
    });
    console.log('└' + '─'.repeat(70) + '┘');
    console.log(`\nLunghezza: ${caseStudyMessage.length} caratteri\n`);

    // Validazione
    const validation = claudeService.validateMessage(caseStudyMessage);
    console.log(`Validazione: Score ${validation.score}/100`);
    if (validation.issues.length > 0) {
      console.log(`Issues: ${validation.issues.join(', ')}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 TEST COMPLETATO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Errore:', error);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
  }
}

testCaseStudyStyle()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });







