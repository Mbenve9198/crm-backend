/**
 * Script per Correggere Stati Messaggi Errati
 * 
 * Corregge i messaggi marcati come "sent" ma con messageId contenente errori
 * Specificamente per "Number not linked to WhatsApp Account"
 * 
 * Utilizzo:
 * node scripts/fixWrongMessageStatus.js
 */

import mongoose from 'mongoose';
import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import { config } from 'dotenv';

// Carica variabili ambiente
config();

async function fixWrongMessageStatus() {
  console.log('🔧 Avvio correzione stati messaggi errati...\n');

  try {
    // Connetti a MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Trova tutte le campagne con messaggi potenzialmente errati
    const campaigns = await WhatsappCampaign.find({
      'messageQueue': {
        $elemMatch: {
          status: 'sent',
          messageId: { $regex: 'Error:', $options: 'i' }
        }
      }
    });

    console.log(`\n📊 Trovate ${campaigns.length} campagne con messaggi da correggere`);

    if (campaigns.length === 0) {
      console.log('✅ Nessuna correzione necessaria');
      return;
    }

    let totalFixed = 0;
    let totalCampaignsFixed = 0;

    for (const campaign of campaigns) {
      console.log(`\n🔍 Analizzando campagna: ${campaign.name} (ID: ${campaign._id})`);
      
      let campaignFixed = false;
      let campaignFixedCount = 0;

      // Trova messaggi con status "sent" ma messageId contenente errori
      campaign.messageQueue.forEach(message => {
        if (message.status === 'sent' && 
            message.messageId && 
            typeof message.messageId === 'string' && 
            message.messageId.includes('Error:')) {
          
          console.log(`   ❌ Fixing message for contact ${message.contactId}: "${message.messageId}"`);
          
          // Correggi lo status
          message.status = 'failed';
          message.errorMessage = message.messageId;
          message.messageId = null; // Pulisci il messageId errato
          
          campaignFixed = true;
          campaignFixedCount++;
          totalFixed++;
        }
      });

      if (campaignFixed) {
        // Aggiorna le statistiche della campagna
        campaign.updateStats();
        
        // Salva la campagna
        await campaign.save();
        
        totalCampaignsFixed++;
        console.log(`   ✅ Corretti ${campaignFixedCount} messaggi in questa campagna`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ CORREZIONE COMPLETATA:`);
    console.log(`   📧 ${totalFixed} messaggi corretti`);
    console.log(`   📊 ${totalCampaignsFixed} campagne aggiornate`);
    console.log(`   🎯 Stati corretti da "sent" a "failed"`);

    if (totalFixed > 0) {
      console.log('\n💡 Benefici della correzione:');
      console.log('   ✅ Statistiche campagne ora accurate');
      console.log('   ✅ Follow-up non programmati per numeri senza WhatsApp');
      console.log('   ✅ Rate limiting più efficiente');
    }

  } catch (error) {
    console.error('❌ Errore durante la correzione:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnesso da MongoDB');
  }
}

// Esegui solo se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
  fixWrongMessageStatus().catch(console.error);
}

export default fixWrongMessageStatus; 