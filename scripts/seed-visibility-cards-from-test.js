#!/usr/bin/env node
/**
 * Carica le schede di test in contact.properties.visibilityCard
 * Uso: node scripts/seed-visibility-cards-from-test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cardsDir = path.join(__dirname, '../analysis/coldcall-alessandro/visibility-cards-test');

async function main() {
  const mongo = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGODB_URI mancante');

  await mongoose.connect(mongo);
  const Contact = (await import('../models/contactModel.js')).default;

  const files = fs.readdirSync(cardsDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  let ok = 0;

  for (const file of files) {
    const card = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
    const id = card.contact?.id || path.basename(file, '.json');
    const contact = await Contact.findById(id);
    if (!contact) {
      console.warn(`skip ${id}: contatto non trovato`);
      continue;
    }
    contact.properties = {
      ...(contact.properties || {}),
      visibilityCard: card,
      visibilityCardGeneratedAt: card.generatedAt || new Date().toISOString(),
    };
    contact.markModified('properties');
    await contact.save();
    console.log(`OK ${contact.name} (${id})`);
    ok += 1;
  }

  console.log(`Salvate ${ok}/${files.length} schede`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
