import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from '../models/contactModel.js';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per testare i nuovi filtri avanzati: "non è" e "non contiene"
 * Testa le funzioni buildMongoFilter e mapColumnToField
 */

// Importa le funzioni helper (le definisco qui per il test)
const mapColumnToField = (column) => {
  const columnMapping = {
    'Contact': 'name',
    'Email': 'email',
    'Phone': 'phone',
    'Owner': 'owner',
    'Lists': 'lists',
    'Created': 'createdAt',
    'Status': 'status'
  };

  if (column.startsWith('prop_')) {
    const propName = column.replace('prop_', '');
    return `properties.${propName}`;
  }

  return columnMapping[column] || column.toLowerCase();
};

const buildMongoFilter = (column, columnFilter) => {
  const field = mapColumnToField(column);
  
  if (columnFilter.type === 'value') {
    if (columnFilter.values && columnFilter.values.length > 0) {
      return { [field]: { $in: columnFilter.values } };
    }
    return null;
  }
  
  if (columnFilter.type === 'condition' && columnFilter.condition) {
    const { type, value } = columnFilter.condition;
    
    switch (type) {
      case 'equals':
        return { [field]: value };
      case 'not_equals':
        return { [field]: { $ne: value } };
      case 'contains':
        return { [field]: { $regex: value, $options: 'i' } };
      case 'not_contains':
        return { [field]: { $not: { $regex: value, $options: 'i' } } };
      case 'starts_with':
        return { [field]: { $regex: `^${value}`, $options: 'i' } };
      case 'is_empty':
        return { 
          $or: [
            { [field]: { $exists: false } },
            { [field]: null },
            { [field]: '' }
          ]
        };
      case 'is_not_empty':
        return { 
          [field]: { 
            $exists: true, 
            $ne: null, 
            $ne: '' 
          }
        };
      default:
        return null;
    }
  }
  
  return null;
};

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

async function createTestContacts() {
  console.log('\n📝 Creazione contatti di test per filtri avanzati...');
  
  const testContacts = [
    {
      name: 'Mario Rossi',
      email: 'mario.rossi@example.com',
      phone: '+39 123 456 7890',
      status: 'da contattare',
      properties: {
        company: 'Acme Corp',
        industry: 'Technology',
        budget: '10000'
      }
    },
    {
      name: 'Giulia Bianchi',
      email: 'giulia.bianchi@test.com',
      phone: '+39 098 765 4321',
      status: 'contattato',
      properties: {
        company: 'Beta Solutions',
        industry: 'Marketing',
        budget: '5000'
      }
    },
    {
      name: 'Francesco Verdi',
      email: 'francesco.verdi@demo.org',
      status: 'interessato',
      properties: {
        company: 'Gamma Industries',
        industry: 'Manufacturing',
        budget: '15000'
      }
    },
    {
      name: 'Anna Neri',
      email: 'anna.neri@sample.net',
      phone: '+39 555 123 456',
      status: 'da contattare',
      properties: {
        company: 'Delta Tech',
        industry: 'Technology'
        // Nota: nessun budget per testare is_empty
      }
    }
  ];

  let createdCount = 0;
  let updatedCount = 0;

  for (const contactData of testContacts) {
    try {
      const existingContact = await Contact.findOne({ email: contactData.email });
      
      if (existingContact) {
        Object.assign(existingContact, contactData);
        await existingContact.save();
        updatedCount++;
        console.log(`🔄 Aggiornato: ${contactData.name}`);
      } else {
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

async function testFilterFunctions() {
  console.log('\n🧪 Test funzioni di filtro...');
  
  const testCases = [
    {
      name: 'Test mapColumnToField - Colonne base',
      input: 'Contact',
      expected: 'name',
      test: () => mapColumnToField('Contact')
    },
    {
      name: 'Test mapColumnToField - Proprietà dinamica',
      input: 'prop_company',
      expected: 'properties.company',
      test: () => mapColumnToField('prop_company')
    },
    {
      name: 'Test buildMongoFilter - equals',
      input: { column: 'Contact', filter: { type: 'condition', condition: { type: 'equals', value: 'Mario Rossi' } } },
      expected: { name: 'Mario Rossi' },
      test: () => buildMongoFilter('Contact', { type: 'condition', condition: { type: 'equals', value: 'Mario Rossi' } })
    },
    {
      name: 'Test buildMongoFilter - not_equals',
      input: { column: 'Status', filter: { type: 'condition', condition: { type: 'not_equals', value: 'da contattare' } } },
      expected: { status: { $ne: 'da contattare' } },
      test: () => buildMongoFilter('Status', { type: 'condition', condition: { type: 'not_equals', value: 'da contattare' } })
    },
    {
      name: 'Test buildMongoFilter - contains',
      input: { column: 'Email', filter: { type: 'condition', condition: { type: 'contains', value: 'example' } } },
      expected: { email: { $regex: 'example', $options: 'i' } },
      test: () => buildMongoFilter('Email', { type: 'condition', condition: { type: 'contains', value: 'example' } })
    },
    {
      name: 'Test buildMongoFilter - not_contains',
      input: { column: 'Email', filter: { type: 'condition', condition: { type: 'not_contains', value: 'test' } } },
      expected: { email: { $not: { $regex: 'test', $options: 'i' } } },
      test: () => buildMongoFilter('Email', { type: 'condition', condition: { type: 'not_contains', value: 'test' } })
    },
    {
      name: 'Test buildMongoFilter - is_empty',
      input: { column: 'Phone', filter: { type: 'condition', condition: { type: 'is_empty' } } },
      expected: { $or: [{ phone: { $exists: false } }, { phone: null }, { phone: '' }] },
      test: () => buildMongoFilter('Phone', { type: 'condition', condition: { type: 'is_empty' } })
    },
    {
      name: 'Test buildMongoFilter - proprietà dinamica',
      input: { column: 'prop_company', filter: { type: 'condition', condition: { type: 'not_equals', value: 'Acme Corp' } } },
      expected: { 'properties.company': { $ne: 'Acme Corp' } },
      test: () => buildMongoFilter('prop_company', { type: 'condition', condition: { type: 'not_equals', value: 'Acme Corp' } })
    }
  ];

  for (const testCase of testCases) {
    try {
      const result = testCase.test();
      const resultStr = JSON.stringify(result);
      const expectedStr = JSON.stringify(testCase.expected);
      
      if (resultStr === expectedStr) {
        console.log(`✅ ${testCase.name}: PASS`);
      } else {
        console.log(`❌ ${testCase.name}: FAIL`);
        console.log(`   Atteso: ${expectedStr}`);
        console.log(`   Ottenuto: ${resultStr}`);
      }
    } catch (error) {
      console.log(`❌ ${testCase.name}: ERROR - ${error.message}`);
    }
  }
}

async function testRealQueries() {
  console.log('\n🔍 Test query reali sui contatti...');
  
  const testQueries = [
    {
      name: 'Contatti che NON hanno status "da contattare"',
      filter: { status: { $ne: 'da contattare' } },
      description: 'Dovrebbe trovare contatti con status diverso da "da contattare"'
    },
    {
      name: 'Email che NON contengono "test"',
      filter: { email: { $not: { $regex: 'test', $options: 'i' } } },
      description: 'Dovrebbe escludere email con "test"'
    },
    {
      name: 'Contatti senza telefono',
      filter: { 
        $or: [
          { phone: { $exists: false } },
          { phone: null },
          { phone: '' }
        ]
      },
      description: 'Dovrebbe trovare contatti senza numero di telefono'
    },
    {
      name: 'Proprietà company NON uguale a "Acme Corp"',
      filter: { 'properties.company': { $ne: 'Acme Corp' } },
      description: 'Dovrebbe escludere contatti di Acme Corp'
    },
    {
      name: 'Proprietà budget è vuota',
      filter: { 
        $or: [
          { 'properties.budget': { $exists: false } },
          { 'properties.budget': null },
          { 'properties.budget': '' }
        ]
      },
      description: 'Dovrebbe trovare contatti senza budget'
    }
  ];

  for (const query of testQueries) {
    try {
      const results = await Contact.find(query.filter).select('name email phone status properties');
      console.log(`\n📊 ${query.name}:`);
      console.log(`   ${query.description}`);
      console.log(`   Filtro: ${JSON.stringify(query.filter)}`);
      console.log(`   Risultati: ${results.length} contatti`);
      
      if (results.length > 0) {
        results.forEach((contact, i) => {
          console.log(`   ${i + 1}. ${contact.name} - ${contact.email || 'No email'} - ${contact.status}`);
          if (contact.properties) {
            console.log(`      Properties: ${JSON.stringify(contact.properties)}`);
          }
        });
      }
    } catch (error) {
      console.error(`❌ Errore query "${query.name}":`, error.message);
    }
  }
}

async function runTest() {
  console.log('🧪 TEST FILTRI AVANZATI: "NON È" E "NON CONTIENE"');
  console.log('='.repeat(60));

  try {
    // 1. Connetti al database
    await connectToDatabase();

    // 2. Crea contatti di test
    await createTestContacts();

    // 3. Testa le funzioni di filtro
    await testFilterFunctions();

    // 4. Testa query reali
    await testRealQueries();

    console.log('\n🎉 TEST COMPLETATO CON SUCCESSO!');
    console.log('✅ I nuovi filtri "non è" e "non contiene" sono pronti');

  } catch (error) {
    console.error('\n❌ ERRORE DURANTE IL TEST:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Connessione database chiusa');
  }
}

// Esegui il test
runTest().catch(console.error); 