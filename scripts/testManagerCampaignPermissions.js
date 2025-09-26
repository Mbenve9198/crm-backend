import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

/**
 * Script per testare che i manager possano accedere a tutti i contatti
 * per le campagne WhatsApp (non solo ai propri)
 */

const testManagerCampaignPermissions = async () => {
  try {
    // Connessione a MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Importa i modelli
    const { default: User } = await import('../models/userModel.js');
    const { default: Contact } = await import('../models/contactModel.js');

    console.log('\n🔍 Test Permessi Manager per Campagne WhatsApp\n');
    console.log('='.repeat(60));

    // Trova tutti gli utenti
    const users = await User.find({}).select('firstName lastName email role');
    
    if (users.length === 0) {
      console.log('❌ Nessun utente trovato nel database');
      return;
    }

    console.log(`📊 Trovati ${users.length} utenti:\n`);

    // Analizza ogni utente
    for (const user of users) {
      console.log(`👤 ${user.firstName} ${user.lastName} (${user.email})`);
      console.log(`   🏢 Ruolo: ${user.role}`);
      console.log(`   🔑 HasRole('manager'): ${user.hasRole('manager')}`);
      
      // Conta contatti di proprietà dell'utente
      const ownContacts = await Contact.countDocuments({ owner: user._id });
      console.log(`   📋 Contatti di proprietà: ${ownContacts}`);
      
      // Conta contatti con telefono di proprietà dell'utente
      const ownContactsWithPhone = await Contact.countDocuments({ 
        owner: user._id,
        phone: { $exists: true, $ne: null, $ne: '' }
      });
      console.log(`   📱 Contatti con telefono (propri): ${ownContactsWithPhone}`);
      
      // Per manager: conta TUTTI i contatti del sistema
      if (user.hasRole('manager')) {
        const allContacts = await Contact.countDocuments({});
        const allContactsWithPhone = await Contact.countDocuments({
          phone: { $exists: true, $ne: null, $ne: '' }
        });
        
        console.log(`   🌍 TUTTI i contatti (privilegio manager): ${allContacts}`);
        console.log(`   📱 TUTTI i contatti con telefono: ${allContactsWithPhone}`);
        
        if (allContactsWithPhone > ownContactsWithPhone) {
          console.log(`   ✅ ACCESSO ESTESO: Può accedere a ${allContactsWithPhone - ownContactsWithPhone} contatti aggiuntivi`);
        } else {
          console.log(`   ⚠️ Nessun contatto aggiuntivo disponibile`);
        }
      } else {
        console.log(`   🔒 Limitato ai propri contatti (ruolo: ${user.role})`);
      }
      
      console.log('   ' + '─'.repeat(50));
    }

    // Test specifico per Federico
    const federico = await User.findOne({ email: 'federico@menuchat.com' });
    
    if (federico) {
      console.log('\n🎯 Test Specifico per Federico');
      console.log('─'.repeat(40));
      console.log(`👤 ${federico.firstName} ${federico.lastName}`);
      console.log(`📧 Email: ${federico.email}`);
      console.log(`🏢 Ruolo: ${federico.role}`);
      console.log(`🔑 È Manager: ${federico.hasRole('manager')}`);
      
      // Test della logica di filtro campagne
      console.log('\n🧪 Simulazione Logica Campagne:');
      
      // Simula la nuova logica di getTargetContacts
      const filter = {};
      
      if (federico.hasRole('manager')) {
        console.log('✅ Federico può accedere a TUTTI i contatti per le campagne');
        console.log('🌍 Filter applicato: {} (nessuna restrizione owner)');
      } else {
        filter.owner = federico._id;
        console.log('🔒 Federico limitato ai propri contatti');
        console.log(`🔍 Filter applicato: { owner: "${federico._id}" }`);
      }
      
      // Conta contatti che Federico può usare per campagne
      const campaignContacts = await Contact.countDocuments({
        ...filter,
        phone: { $exists: true, $ne: null, $ne: '' }
      });
      
      console.log(`📊 Contatti disponibili per campagne: ${campaignContacts}`);
      
      // Mostra breakdown per owner
      if (federico.hasRole('manager')) {
        console.log('\n📈 Breakdown contatti per proprietario:');
        const contactsByOwner = await Contact.aggregate([
          { 
            $match: { 
              phone: { $exists: true, $ne: null, $ne: '' } 
            } 
          },
          {
            $lookup: {
              from: 'users',
              localField: 'owner',
              foreignField: '_id',
              as: 'ownerInfo'
            }
          },
          {
            $group: {
              _id: '$owner',
              count: { $sum: 1 },
              ownerName: { $first: { $arrayElemAt: ['$ownerInfo.firstName', 0] } },
              ownerLastName: { $first: { $arrayElemAt: ['$ownerInfo.lastName', 0] } },
              ownerEmail: { $first: { $arrayElemAt: ['$ownerInfo.email', 0] } }
            }
          },
          { $sort: { count: -1 } }
        ]);
        
        if (contactsByOwner.length > 0) {
          contactsByOwner.forEach(owner => {
            console.log(`   👤 ${owner.ownerName} ${owner.ownerLastName} (${owner.ownerEmail}): ${owner.count} contatti`);
          });
        } else {
          console.log('   ❌ Nessun contatto con telefono trovato');
        }
      }
      
    } else {
      console.log('\n❌ Federico non trovato nel database');
      console.log('💡 Assicurati che sia stato creato con lo script createUsers');
    }

    // Riepilogo finale
    console.log('\n🏁 Riepilogo Test');
    console.log('='.repeat(30));
    
    const managers = users.filter(u => u.hasRole('manager'));
    const agents = users.filter(u => u.role === 'agent');
    const totalContacts = await Contact.countDocuments({});
    const contactsWithPhone = await Contact.countDocuments({
      phone: { $exists: true, $ne: null, $ne: '' }
    });
    
    console.log(`👥 Manager nel sistema: ${managers.length}`);
    console.log(`🏃 Agent nel sistema: ${agents.length}`);
    console.log(`📋 Contatti totali: ${totalContacts}`);
    console.log(`📱 Contatti con telefono: ${contactsWithPhone}`);
    
    if (managers.length > 0) {
      console.log('\n✅ Manager che possono accedere a TUTTI i contatti:');
      managers.forEach(manager => {
        console.log(`   - ${manager.firstName} ${manager.lastName} (${manager.email})`);
      });
    }
    
    if (agents.length > 0) {
      console.log('\n🔒 Agent limitati ai propri contatti:');
      for (const agent of agents) {
        const agentContacts = await Contact.countDocuments({ 
          owner: agent._id,
          phone: { $exists: true, $ne: null, $ne: '' }
        });
        console.log(`   - ${agent.firstName} ${agent.lastName}: ${agentContacts} contatti`);
      }
    }

    console.log('\n💡 Come testare:');
    console.log('1. Accedi come Federico nel frontend');
    console.log('2. Vai su WhatsApp Campaigns');
    console.log('3. Crea una nuova campagna');
    console.log('4. Seleziona "Tutti i contatti" o una lista');
    console.log('5. Federico dovrebbe vedere TUTTI i contatti del sistema');

  } catch (error) {
    console.error('❌ Errore generale:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Disconnesso dal database');
  }
};

// Esegui il test
testManagerCampaignPermissions(); 