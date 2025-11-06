import express from 'express';
import WhatsappSession from '../models/whatsappSessionModel.js';
import whatsappService from '../services/whatsappService.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = express.Router();

/**
 * Test diagnostico sendPtt
 * GET /api/test/sendptt?number=393934274642
 */
router.get('/sendptt', async (req, res) => {
  try {
    const testNumber = req.query.number || '393934274642';
    
    // Trova sessione attiva
    const session = await WhatsappSession.findOne({
      status: { $in: ['connected', 'authenticated'] }
    }).sort({ updatedAt: -1 });

    if (!session) {
      return res.json({ success: false, error: 'Nessuna sessione attiva' });
    }

    // Ottieni client
    const client = whatsappService.sessions.get(session.sessionId);
    if (!client) {
      return res.json({ success: false, error: 'Client non trovato', session: session.name });
    }

    const chatId = `${testNumber.replace(/[^0-9]/g, '')}@c.us`;

    // DataURL OGG piccolo per test
    const tinyOggDataUrl = 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABpFVEsAAAAAJZ8W4sBHgF2b3JiaXMAAAAAAUSsAAAAAAAAgLsAAAAAAAC4AU9nZ1MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    
    // Test 1: File path
    const matches = tinyOggDataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    let result1 = false;
    let tempFile = null;
    
    if (matches) {
      const buffer = Buffer.from(matches[2], 'base64');
      tempFile = path.join(os.tmpdir(), `test-voice-${Date.now()}.ogg`);
      fs.writeFileSync(tempFile, buffer);
      
      console.log(`📝 Test 1: sendPtt con file path ${tempFile}`);
      result1 = await client.sendPtt(chatId, tempFile);
      
      fs.unlinkSync(tempFile);
    }

    // Aspetta 2 secondi
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: DataURL
    console.log(`📝 Test 2: sendPtt con DataURL`);
    const result2 = await client.sendPtt(chatId, tinyOggDataUrl);

    res.json({
      success: true,
      session: {
        name: session.name,
        sessionId: session.sessionId,
        phone: session.phoneNumber
      },
      testNumber: testNumber,
      chatId: chatId,
      results: {
        filePath: {
          result: result1,
          success: result1 !== false,
          type: typeof result1
        },
        dataUrl: {
          result: result2,
          success: result2 !== false,
          type: typeof result2
        }
      },
      conclusion: 
        result1 !== false || result2 !== false
          ? '✅ sendPtt funziona! Il problema è altrove.'
          : '❌ sendPtt non funziona. Possibile problema sessione/account WhatsApp.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

export default router;

