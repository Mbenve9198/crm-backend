import VoiceFile from '../models/voiceFileModel.js';

/**
 * Upload vocale e salva in collezione separata
 * POST /api/voice-files/upload
 */
export const uploadVoiceFile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { dataUrl, filename, size, duration } = req.body;

    if (!dataUrl || !dataUrl.startsWith('data:audio/')) {
      return res.status(400).json({
        success: false,
        message: 'DataURL audio valido richiesto'
      });
    }

    // Estrai mime type
    const mimeTypeMatch = dataUrl.match(/^data:([^;]+);/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'audio/ogg';

    // Crea VoiceFile
    const voiceFile = new VoiceFile({
      dataUrl,
      filename: filename || 'vocale.ogg',
      size: size || 0,
      duration,
      mimeType,
      owner: userId,
      createdBy: userId
    });

    await voiceFile.save();

    console.log(`✅ VoiceFile salvato: ${voiceFile._id} (${(size / 1024).toFixed(2)} KB)`);

    res.json({
      success: true,
      data: {
        voiceFileId: voiceFile._id,
        filename: voiceFile.filename,
        size: voiceFile.size,
        duration: voiceFile.duration,
        // URL pubblico per accesso (SEMPRE HTTPS per WhatsApp)
        publicUrl: `${process.env.API_URL || 'https://' + req.get('host')}/api/voice-files/${voiceFile._id}/audio`
      },
      message: 'Vocale salvato con successo'
    });

  } catch (error) {
    console.error('Errore upload voice file:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Serve file audio (ENDPOINT PUBBLICO - NO AUTH)
 * GET /api/voice-files/:id/audio
 */
export const serveVoiceFile = async (req, res) => {
  try {
    const { id } = req.params;

    const voiceFile = await VoiceFile.findById(id);

    if (!voiceFile) {
      return res.status(404).json({
        success: false,
        message: 'File vocale non trovato'
      });
    }

    // 🔍 DEBUG: Log DataURL per vedere formato
    console.log(`🔍 VoiceFile trovato: ${id}`);
    console.log(`   - filename: ${voiceFile.filename}`);
    console.log(`   - size: ${voiceFile.size}`);
    console.log(`   - dataUrl type: ${typeof voiceFile.dataUrl}`);
    console.log(`   - dataUrl length: ${voiceFile.dataUrl?.length || 0}`);
    console.log(`   - dataUrl primi 100 char: ${voiceFile.dataUrl?.substring(0, 100)}`);
    console.log(`   - dataUrl ultimi 50 char: ${voiceFile.dataUrl?.substring(voiceFile.dataUrl.length - 50)}`);

    // Estrai Base64 dal DataURL
    // Regex aggiornato per gestire codecs: data:audio/webm;codecs=opus;base64,...
    const matches = voiceFile.dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    
    if (!matches) {
      console.error(`❌ DataURL NON matcha regex!`);
      console.error(`   - Inizia con 'data:': ${voiceFile.dataUrl?.startsWith('data:')}`);
      console.error(`   - Contiene ';base64,': ${voiceFile.dataUrl?.includes(';base64,')}`);
      
      return res.status(500).json({
        success: false,
        message: 'DataURL non valido',
        debug: {
          hasDataUrl: !!voiceFile.dataUrl,
          startsWithData: voiceFile.dataUrl?.startsWith('data:'),
          hasBase64: voiceFile.dataUrl?.includes(';base64,'),
          length: voiceFile.dataUrl?.length
        }
      });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    console.log(`📤 Serving voice file ${id}: ${voiceFile.filename} (${(buffer.length / 1024).toFixed(2)} KB)`);

    // Serve il file audio
    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      'Content-Disposition': `inline; filename="${voiceFile.filename}"`,
      'Cache-Control': 'public, max-age=86400', // Cache 24h
      'Access-Control-Allow-Origin': '*' // Permetti WhatsApp di scaricare
    });

    res.send(buffer);

  } catch (error) {
    console.error('Errore serving voice file:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina voice file
 * DELETE /api/voice-files/:id
 */
export const deleteVoiceFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const voiceFile = await VoiceFile.findOne({
      _id: id,
      owner: userId
    });

    if (!voiceFile) {
      return res.status(404).json({
        success: false,
        message: 'File vocale non trovato'
      });
    }

    await voiceFile.deleteOne();

    console.log(`🗑️ VoiceFile eliminato: ${id}`);

    res.json({
      success: true,
      message: 'File vocale eliminato'
    });

  } catch (error) {
    console.error('Errore eliminazione voice file:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};
