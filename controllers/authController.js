import User from '../models/userModel.js';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';

/**
 * Controller per autenticazione e gestione utenti MenuChatCRM
 * Include login, registrazione, gestione profili e controllo accessi
 */

// Configurazione JWT
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET non configurato nelle variabili d\'ambiente');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Genera token JWT per l'utente
 * @param {string} id - ID dell'utente
 * @returns {string} - Token JWT
 */
const signToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

/**
 * Crea e invia risposta con token
 * @param {Object} user - Utente
 * @param {number} statusCode - Codice di stato HTTP
 * @param {Object} res - Response object
 * @param {string} message - Messaggio di risposta
 */
const createSendToken = (user, statusCode, res, message = 'Operazione completata') => {
  const token = signToken(user._id);
  
  // Configurazione cookie per il token
  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 giorni
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  };

  res.cookie('jwt', token, cookieOptions);

  // Rimuove la password dalla risposta
  user.password = undefined;

  res.status(statusCode).json({
    success: true,
    message,
    token,
    data: {
      user
    }
  });
};

/**
 * Registrazione nuovo utente
 * POST /auth/register
 */
export const register = async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      password, 
      role, 
      department, 
      phone 
    } = req.body;

    // Validazioni di base
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, cognome, email e password sono obbligatori'
      });
    }

    // Verifica se l'email esiste già
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Utente con questa email già esistente'
      });
    }

    // Controllo autorizzazioni per creazione utenti
    if (req.user) {
      // Se l'utente è autenticato, controlla i permessi per il ruolo
      if (role && role !== 'agent' && !req.user.hasRole('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Non hai i permessi per creare utenti con questo ruolo'
        });
      }
    }

    // Crea il nuovo utente
    const userData = {
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      role: role || 'agent',
      department,
      phone
    };

    // Se creato da un utente autenticato, salva il riferimento
    if (req.user) {
      userData.createdBy = req.user._id;
    }

    const newUser = await User.create(userData);

    // Aggiorna statistiche del creatore se presente
    if (req.user) {
      req.user.updateStats({ newUser: true });
      await req.user.save();
    }

    createSendToken(newUser, 201, res, 'Utente registrato con successo');

  } catch (error) {
    console.error('Errore nella registrazione:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email già in uso'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Login utente
 * POST /auth/login
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Verifica che email e password siano fornite
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e password sono obbligatorie'
      });
    }

    // Trova l'utente e include la password per la verifica
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Email o password non corretti'
      });
    }

    // Verifica che l'account sia attivo
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account disattivato. Contatta l\'amministratore'
      });
    }

    // Aggiorna statistiche di login
    user.updateStats({ login: true });
    await user.save();

    createSendToken(user, 200, res, 'Login effettuato con successo');

  } catch (error) {
    console.error('Errore nel login:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Logout utente
 * POST /auth/logout
 */
export const logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logout effettuato con successo'
  });
};

/**
 * Middleware per proteggere le routes (autenticazione richiesta)
 */
export const protect = async (req, res, next) => {
  try {
    // 1) Ottieni il token e verifica che esista
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Non sei autenticato. Effettua il login per accedere'
      });
    }

    // 2) Verifica il token
    const decoded = await promisify(jwt.verify)(token, JWT_SECRET);

    // 3) Verifica che l'utente esista ancora
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'L\'utente associato a questo token non esiste più'
      });
    }

    // 4) Verifica che l'utente sia attivo
    if (!currentUser.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Il tuo account è stato disattivato'
      });
    }

    // Garantisci l'accesso alla prossima middleware
    req.user = currentUser;
    next();

  } catch (error) {
    console.error('Errore nell\'autenticazione:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token non valido'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token scaduto. Effettua nuovamente il login'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore nell\'autenticazione'
    });
  }
};

/**
 * Middleware per autorizzazione basata sui ruoli
 * @param {...string} roles - Ruoli autorizzati
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per accedere a questa risorsa'
      });
    }
    next();
  };
};

/**
 * Middleware per verificare ownership o ruolo manager/admin
 */
export const checkOwnershipOrRole = (ownerField = 'owner') => {
  return (req, res, next) => {
    // Admin e manager possono sempre procedere
    if (req.user.hasRole('manager')) {
      return next();
    }

    // Per agent e viewer, verifica ownership nel middleware successivo
    req.checkOwnership = true;
    req.ownerField = ownerField;
    next();
  };
};

/**
 * Ottieni informazioni utente corrente
 * GET /auth/me
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Errore nel recupero profilo:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna profilo utente corrente
 * PUT /auth/me
 */
export const updateMe = async (req, res) => {
  try {
    // Campi che l'utente può modificare da solo
    const allowedFields = [
      'firstName', 
      'lastName', 
      'phone', 
      'department', 
      'avatar',
      'settings'
    ];

    // Filtra solo i campi permessi
    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Aggiorna l'utente
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profilo aggiornato con successo',
      data: {
        user: updatedUser
      }
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento del profilo:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Cambia password
 * PUT /auth/change-password
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password attuale e nuova password sono obbligatorie'
      });
    }

    // Ottieni utente con password
    const user = await User.findById(req.user._id).select('+password');

    // Verifica password attuale
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({
        success: false,
        message: 'Password attuale non corretta'
      });
    }

    // Aggiorna password
    user.password = newPassword;
    await user.save();

    createSendToken(user, 200, res, 'Password cambiata con successo');

  } catch (error) {
    console.error('Errore nel cambio password:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 