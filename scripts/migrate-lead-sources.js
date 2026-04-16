#!/usr/bin/env node

/**
 * Migrazione: aggiorna source e lists dei contatti inbound
 * basandosi su rankCheckerData.leadSource (già salvato correttamente).
 *
 * Prima: tutti i lead non-prova-gratuita hanno source='inbound_rank_checker'
 * Dopo: ogni lead ha il source corretto e la lista CRM corrispondente
 *
 * Uso: node scripts/migrate-lead-sources.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

const SOURCE_MAP = {
  'prova-gratuita': {
    source: 'inbound_prova_gratuita',
    list: 'Inbound - Prova Gratuita'
  },
  'menu-digitale-landing': {
    source: 'inbound_menu_landing',
    list: 'Inbound - Google Ads Menu'
  },
  'social-proof': {
    source: 'inbound_social_proof',
    list: 'Inbound - Meta Social Proof'
  },
  'qr-recensioni': {
    source: 'inbound_qr_recensioni',
    list: 'Inbound - Google Ads QR Recensioni'
  },
  'organic': {
    source: 'inbound_rank_checker',
    list: 'Inbound - Rank Checker'
  }
};

async function migrate() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — nessuna modifica' : '🚀 MIGRAZIONE LIVE'}\n`);

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connesso a MongoDB\n');

  const Contact = mongoose.connection.collection('contacts');

  // Trova tutti i contatti inbound con rankCheckerData.leadSource
  const contacts = await Contact.find({
    'rankCheckerData.leadSource': { $exists: true, $ne: null }
  }).toArray();

  console.log(`📊 Trovati ${contacts.length} contatti con rankCheckerData.leadSource\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const contact of contacts) {
    const leadSource = contact.rankCheckerData?.leadSource;
    const currentSource = contact.source;
    const mapping = SOURCE_MAP[leadSource];

    if (!mapping) {
      console.log(`  ⚠️ ${contact.name} — leadSource sconosciuto: "${leadSource}", skip`);
      skipped++;
      continue;
    }

    // Controlla se serve aggiornare
    const needsSourceUpdate = currentSource !== mapping.source;
    const needsListUpdate = !contact.lists?.includes(mapping.list);

    if (!needsSourceUpdate && !needsListUpdate) {
      skipped++;
      continue;
    }

    console.log(`  ${DRY_RUN ? '👁️' : '✏️'} ${contact.name}`);
    console.log(`     leadSource: "${leadSource}"`);
    if (needsSourceUpdate) {
      console.log(`     source: "${currentSource}" → "${mapping.source}"`);
    }
    if (needsListUpdate) {
      console.log(`     +list: "${mapping.list}"`);
    }

    if (!DRY_RUN) {
      const updateOps = {};
      if (needsSourceUpdate) {
        updateOps.source = mapping.source;
      }

      const pushOps = {};
      if (needsListUpdate) {
        pushOps.lists = mapping.list;
      }

      const update = {};
      if (Object.keys(updateOps).length) update.$set = updateOps;
      if (Object.keys(pushOps).length) update.$addToSet = pushOps;

      try {
        await Contact.updateOne({ _id: contact._id }, update);
        updated++;
      } catch (err) {
        console.log(`     ❌ Errore: ${err.message}`);
        errors++;
      }
    } else {
      updated++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Risultato${DRY_RUN ? ' (DRY RUN)' : ''}:`);
  console.log(`   ✅ Aggiornati: ${updated}`);
  console.log(`   ⏭️ Già corretti: ${skipped}`);
  console.log(`   ❌ Errori: ${errors}`);
  console.log(`${'─'.repeat(50)}\n`);

  await mongoose.disconnect();
  console.log('👋 Disconnesso da MongoDB');
}

migrate().catch(err => {
  console.error('❌ Migrazione fallita:', err);
  process.exit(1);
});
