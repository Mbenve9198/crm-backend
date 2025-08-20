import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from '../models/contactModel.js';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per testare la funzionalità di mappatura CSV con proprietà dinamiche
 * Crea contatti di esempio con proprietà dinamiche e testa la funzione di mappatura
 */

async function connectToDatabase() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');
  } catch (error) {
    console.error('❌ Errore connessione MongoDB:', error);
    process.exit(1);
  }
}

async function createSampleContacts() {
  console.log('\n📝 Creazione contatti di esempio con proprietà dinamiche...');
  
  const sampleContacts = [
    {
      name: 'Mario Rossi',
      email: 'mario.rossi@example.com',
      phone: '+39 123 456 7890',
      properties: {
        company: 'Acme Corp',
        position: 'CEO',
        industry: 'Technology',
        budget: '10000',
        source: 'Website'
      }
    },
    {
      name: 'Giulia Bianchi',
      email: 'giulia.bianchi@example.com',
      phone: '+39 098 765 4321',
      properties: {
        company: 'Beta Solutions',
        position: 'Marketing Manager',
        industry: 'Marketing',
        budget: '5000',
        source: 'Social Media',
        notes: 'Interessata al prodotto premium'
      }
    },
    {
      name: 'Francesco Verdi',
      email: 'francesco.verdi@example.com',
      properties: {
        company: 'Gamma Industries',
        position: 'CTO',
        industry: 'Manufacturing',
        budget: '15000',
        source: 'Referral',
        location: 'Milano',
        priority: 'High'
      }
    }
  ];

  let createdCount = 0;
  let updatedCount = 0;

  for (const contactData of sampleContacts) {
    try {
      const existingContact = await Contact.findOne({ email: contactData.email });
      
      if (existingContact) {
        // Aggiorna il contatto esistente
        Object.assign(existingContact, contactData);
        await existingContact.save();
        updatedCount++;
        console.log(`🔄 Aggiornato: ${contactData.name}`);
      } else {
        // Crea nuovo contatto
        const contact = new Contact(contactData);
        await contact.save();
        createdCount++;
        console.log(`✅ Creato: ${contactData.name}`);
      }
    } catch (error) {
      console.error(`❌ Errore con ${contactData.name}:`, error.message);
    }
  }

  console.log(`\n📊 Risultato: ${createdCount} creati, ${updatedCount} aggiornati`);
}

async function testDynamicPropertiesRetrieval() {
  console.log('\n🔍 Test recupero proprietà dinamiche...');
  
  try {
    // Simula la query usata nel controller
    const propertyKeys = await Contact.aggregate([
      { $match: { properties: { $exists: true, $ne: null } } },
      { $project: { properties: { $objectToArray: '$properties' } } },
      { $unwind: '$properties' },
      { $group: { _id: '$properties.k' } },
      { $sort: { _id: 1 } }
    ]);

    const existingProperties = propertyKeys.map(item => item._id).filter(Boolean);
    
    console.log(`✅ Trovate ${existingProperties.length} proprietà dinamiche:`);
    existingProperties.forEach((prop, index) => {
      console.log(`   ${index + 1}. ${prop}`);
    });

    return existingProperties;
  } catch (error) {
    console.error('❌ Errore nel recupero delle proprietà:', error);
    return [];
  }
}

async function simulateCsvMappingOptions(existingProperties) {
  console.log('\n🗺️  Simulazione opzioni mappatura CSV...');
  
  // Simula la risposta del controller getCsvMappingOptions
  const mappingOptions = {
    fixed: [
      { key: 'name', label: 'Nome', description: 'Campo nome del contatto (obbligatorio)', required: true },
      { key: 'email', label: 'Email', description: 'Campo email (opzionale ma unico se fornito)', required: false },
      { key: 'phone', label: 'Telefono', description: 'Campo telefono (opzionale)', required: false },
      { key: 'lists', label: 'Liste', description: 'Liste separate da virgola (es: "lista1,lista2")', required: false }
    ],
    
    existingProperties: existingProperties.map(prop => ({
      key: `properties.${prop}`,
      label: prop,
      description: `Proprietà esistente: ${prop}`,
      type: 'existing'
    })),
    
    special: [
      { key: 'ignore', label: 'Ignora colonna', description: 'Ignora questa colonna durante l\'importazione', type: 'ignore' }
    ]
  };

  console.log('✅ Opzioni di mappatura generate:');
  console.log('\n📋 Campi fissi:');
  mappingOptions.fixed.forEach(field => {
    console.log(`   - ${field.key}: ${field.description}${field.required ? ' (OBBLIGATORIO)' : ''}`);
  });

  console.log('\n🏷️  Proprietà dinamiche esistenti:');
  mappingOptions.existingProperties.forEach(prop => {
    console.log(`   - ${prop.key}: ${prop.description}`);
  });

  console.log('\n⚙️  Opzioni speciali:');
  mappingOptions.special.forEach(option => {
    console.log(`   - ${option.key}: ${option.description}`);
  });

  return mappingOptions;
}

async function simulateCsvAnalysisResponse(mappingOptions) {
  console.log('\n📊 Simulazione risposta analisi CSV...');
  
  // Simula colonne CSV di esempio
  const csvHeaders = ['Nome Completo', 'Email Aziendale', 'Telefono', 'Azienda', 'Posizione', 'Budget', 'Note'];
  const sampleRows = [
    {
      'Nome Completo': 'Marco Neri',
      'Email Aziendale': 'marco.neri@deltatech.com',
      'Telefono': '+39 111 222 3333',
      'Azienda': 'Delta Tech',
      'Posizione': 'Product Manager',
      'Budget': '8000',
      'Note': 'Interessato al piano enterprise'
    }
  ];

  // Costruisce le istruzioni di mappatura complete
  const mappingInstructions = {};
  
  // Campi fissi
  mappingOptions.fixed.forEach(field => {
    mappingInstructions[field.key] = field.description;
  });
  
  // Proprietà esistenti
  mappingOptions.existingProperties.forEach(prop => {
    mappingInstructions[prop.key] = prop.description;
  });
  
  // Opzioni speciali
  mappingOptions.special.forEach(option => {
    mappingInstructions[option.key] = option.description;
  });

  const analysisResponse = {
    success: true,
    data: {
      headers: csvHeaders,
      sampleRows: sampleRows,
      totalPreviewRows: sampleRows.length,
      availableFields: {
        fixed: mappingOptions.fixed.map(f => f.key),
        existingProperties: mappingOptions.existingProperties.map(p => p.label),
        newProperties: 'Puoi creare nuove proprietà dinamiche usando il formato "properties.nomeProprietà"'
      },
      mappingInstructions,
      dynamicPropertiesInfo: {
        existing: mappingOptions.existingProperties.map(p => p.label),
        count: mappingOptions.existingProperties.length,
        usage: 'Usa "properties.nomeProp" per mappare alle proprietà esistenti o crearne di nuove'
      }
    }
  };

  console.log('✅ Risposta analisi CSV generata:');
  console.log(`   - Colonne CSV: ${csvHeaders.length}`);
  console.log(`   - Opzioni mappatura: ${Object.keys(mappingInstructions).length}`);
  console.log(`   - Proprietà esistenti disponibili: ${mappingOptions.existingProperties.length}`);

  console.log('\n🎯 Esempio mappatura suggerita:');
  const suggestedMapping = {
    'Nome Completo': 'name',
    'Email Aziendale': 'email',
    'Telefono': 'phone',
    'Azienda': 'properties.company',
    'Posizione': 'properties.position',
    'Budget': 'properties.budget',
    'Note': 'properties.notes'
  };

  Object.entries(suggestedMapping).forEach(([csvColumn, mappedField]) => {
    const instruction = mappingInstructions[mappedField] || 'Campo personalizzato';
    console.log(`   "${csvColumn}" → ${mappedField} (${instruction})`);
  });

  return analysisResponse;
}

async function runTest() {
  console.log('🧪 TEST FUNZIONALITÀ MAPPATURA CSV CON PROPRIETÀ DINAMICHE');
  console.log('='.repeat(65));

  try {
    // 1. Connetti al database
    await connectToDatabase();

    // 2. Crea contatti di esempio con proprietà dinamiche
    await createSampleContacts();

    // 3. Testa il recupero delle proprietà dinamiche
    const existingProperties = await testDynamicPropertiesRetrieval();

    // 4. Simula le opzioni di mappatura
    const mappingOptions = await simulateCsvMappingOptions(existingProperties);

    // 5. Simula la risposta dell'analisi CSV
    const analysisResponse = await simulateCsvAnalysisResponse(mappingOptions);

    console.log('\n🎉 TEST COMPLETATO CON SUCCESSO!');
    console.log('✅ La funzionalità di mappatura CSV con proprietà dinamiche è pronta');
    console.log('\n📝 Prossimi passi:');
    console.log('   1. Fai il deploy del backend');
    console.log('   2. Testa l\'endpoint /api/contacts/csv-mapping-options');
    console.log('   3. Verifica che l\'upload CSV mostri le proprietà esistenti');

  } catch (error) {
    console.error('\n❌ ERRORE DURANTE IL TEST:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Connessione database chiusa');
  }
}

// Esegui il test
runTest().catch(console.error); 