/**
 * Script di Diagnostica Campagne Bloccate
 * 
 * Questo script identifica e ripara campagne WhatsApp che potrebbero essere
 * bloccate in loop infiniti a causa di messaggi pending che non vengono processati.
 * 
 * Utilizzo:
 * node scripts/diagnoseCampaignLoops.js
 */

import mongoose from 'mongoose';
import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import { config } from 'dotenv';

// Carica variabili ambiente
config();

async function diagnoseCampaignLoops() {
  console.log('🔍 Avvio diagnostica campagne bloccate...\n');

  try {
    // Connetti a MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connesso a MongoDB');

    // Trova tutte le campagne running
    const runningCampaigns = await WhatsappCampaign.find({ status: 'running' });
    console.log(`\n📊 Trovate ${runningCampaigns.length} campagne in esecuzione`);

    if (runningCampaigns.length === 0) {
      console.log('✅ Nessuna campagna running da diagnosticare');
      return;
    }

    console.log('\n' + '='.repeat(80));

    for (const campaign of runningCampaigns) {
      console.log(`\n🔍 ANALISI CAMPAGNA: ${campaign.name} (ID: ${campaign._id})`);
      console.log('─'.repeat(60));

      // Statistiche messaggi
      const stats = {
        total: campaign.messageQueue.length,
        pending: campaign.messageQueue.filter(m => m.status === 'pending').length,
        sent: campaign.messageQueue.filter(m => m.status === 'sent').length,
        delivered: campaign.messageQueue.filter(m => m.status === 'delivered').length,
        read: campaign.messageQueue.filter(m => m.status === 'read').length,
        failed: campaign.messageQueue.filter(m => m.status === 'failed').length
      };

      console.log(`📊 Statistiche:`);
      console.log(`   Total: ${stats.total}`);
      console.log(`   Pending: ${stats.pending}`);
      console.log(`   Sent: ${stats.sent}`);
      console.log(`   Delivered: ${stats.delivered}`);
      console.log(`   Read: ${stats.read}`);
      console.log(`   Failed: ${stats.failed}`);

      // Controlla se dovrebbe essere completata
      const allProcessed = campaign.messageQueue.every(m => 
        ['sent', 'delivered', 'read', 'failed'].includes(m.status)
      );

      if (allProcessed) {
        console.log('🟡 PROBLEMA RILEVATO: Campagna dovrebbe essere completata ma è ancora running');
        console.log('🔧 CORREZIONE: Marcando campagna come completata...');
        
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        await campaign.save();
        
        console.log('✅ Campagna marcata come completata');
        continue;
      }

      // Analizza messaggi pending
      const pendingMessages = campaign.messageQueue.filter(m => m.status === 'pending');
      
      if (pendingMessages.length > 0) {
        console.log(`\n🔍 Analisi ${pendingMessages.length} messaggi pending:`);
        
        // Raggruppa per sequenceIndex
        const bySequence = {};
        pendingMessages.forEach(msg => {
          const seq = msg.sequenceIndex || 0;
          if (!bySequence[seq]) bySequence[seq] = [];
          bySequence[seq].push(msg);
        });

        Object.keys(bySequence).forEach(seq => {
          console.log(`   Sequenza ${seq}: ${bySequence[seq].length} messaggi`);
        });

        // Cerca duplicati potenziali (stesso contatto, stessa sequenza)
        const duplicateCheck = {};
        let duplicates = 0;

        pendingMessages.forEach(msg => {
          const key = `${msg.contactId}_${msg.sequenceIndex}`;
          if (duplicateCheck[key]) {
            duplicateCheck[key]++;
            duplicates++;
          } else {
            duplicateCheck[key] = 1;
          }
        });

        if (duplicates > 0) {
          console.log(`🔴 PROBLEMA RILEVATO: ${duplicates} messaggi duplicati trovati!`);
          console.log('🔧 CORREZIONE: Rimuovendo duplicati...');
          
          // Rimuovi duplicati mantenendo solo il primo di ogni gruppo
          const seen = new Set();
          const toRemove = [];
          
          campaign.messageQueue.forEach((msg, index) => {
            if (msg.status === 'pending') {
              const key = `${msg.contactId}_${msg.sequenceIndex}`;
              if (seen.has(key)) {
                toRemove.push(index);
              } else {
                seen.add(key);
              }
            }
          });

          // Rimuovi dal fondo per non alterare gli indici
          toRemove.reverse().forEach(index => {
            campaign.messageQueue.splice(index, 1);
          });

          if (toRemove.length > 0) {
            await campaign.save();
            console.log(`✅ Rimossi ${toRemove.length} messaggi duplicati`);
          }
        }

        // Controlla follow-up scaduti
        const now = new Date();
        const overdueFollowUps = pendingMessages.filter(msg => 
          msg.sequenceIndex > 0 && 
          msg.followUpScheduledFor && 
          msg.followUpScheduledFor < now
        );

        if (overdueFollowUps.length > 0) {
          console.log(`⚠️ ${overdueFollowUps.length} follow-up scaduti trovati`);
          
          // Mostra primi 3 per debug
          overdueFollowUps.slice(0, 3).forEach((msg, idx) => {
            const delay = Math.round((now - msg.followUpScheduledFor) / (60 * 1000));
            console.log(`   ${idx + 1}. Contatto: ${msg.contactId.toString().slice(-6)}, ritardo: ${delay} min`);
          });
        }

        // Controlla messaggi senza scheduledAt appropriato
        const invalidScheduling = pendingMessages.filter(msg => 
          msg.sequenceIndex === 0 && 
          msg.scheduledAt && 
          msg.scheduledAt > now
        );

        if (invalidScheduling.length > 0) {
          console.log(`⚠️ ${invalidScheduling.length} messaggi principali con scheduledAt futuro`);
        }
      }

      // Controlla sequenze configurate vs messaggi
      const hasSequences = campaign.messageSequences && campaign.messageSequences.length > 0;
      const hasFollowUps = campaign.messageQueue.some(m => m.sequenceIndex > 0);
      
      if (hasSequences && !hasFollowUps) {
        console.log('🟡 Campagna ha sequenze configurate ma nessun follow-up in coda');
      }

      console.log(`\n📅 Creata: ${campaign.createdAt.toISOString()}`);
      console.log(`📅 Avviata: ${campaign.actualStartedAt ? campaign.actualStartedAt.toISOString() : 'Non ancora avviata'}`);
      
      const runningTime = campaign.actualStartedAt ? 
        Math.round((now - campaign.actualStartedAt) / (60 * 1000)) : 0;
      
      if (runningTime > 60 * 24) { // Più di 24 ore
        console.log(`⚠️ Campagna in esecuzione da ${Math.round(runningTime / 60)} ore - potrebbe essere bloccata`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Diagnostica completata');

  } catch (error) {
    console.error('❌ Errore durante la diagnostica:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnesso da MongoDB');
  }
}

// Esegui solo se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
  diagnoseCampaignLoops().catch(console.error);
}

export default diagnoseCampaignLoops; 