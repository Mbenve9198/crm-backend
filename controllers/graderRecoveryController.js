import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';
import { createGraderRecoveryService, parseRecoveryInput } from '../services/graderAbandonmentRecoveryService.js';

const service = createGraderRecoveryService(Contact, User);
export const checkGraderRecovery = async (req, res) => {
  try { return res.json(await service.check(parseRecoveryInput(req.body))); }
  catch (error) { return res.status(error.status || 503).json({ success: false, message: 'Verifica recupero non disponibile' }); }
};
export const syncGraderRecovery = async (req, res) => {
  try { return res.json(await service.sync(parseRecoveryInput(req.body, true))); }
  catch (error) { return res.status(error.status || 503).json({ success: false, message: 'Sincronizzazione recupero non disponibile' }); }
};
