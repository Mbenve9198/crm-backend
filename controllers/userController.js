import User from '../models/userModel.js';
import Contact from '../models/contactModel.js';

/**
 * Controller per gestione utenti - Operazioni amministrative
 * Include CRUD utenti, trasferimenti ownership, statistiche
 */

/**
 * Ottieni lista di tutti gli utenti (solo admin/manager)
 * GET /users
 */
export const getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      role, 
      department, 
      isActive,
      search 
    } = req.query;

    const skip = (page - 1) * limit;

    // Costruisce il filtro
    const filter = {};
    
    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Esegue la query con popolazione
    const users = await User.find(filter)
      .populate('createdBy', 'firstName lastName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(filter);

    // Aggiunge statistiche contatti per ogni utente
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const contactCount = await Contact.countByOwner(user._id);
        return {
          ...user.toObject(),
          contactsCount: contactCount
        };
      })
    );

    res.json({
      success: true,
      data: {
        users: usersWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: skip + users.length < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero degli utenti:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni utente per ID
 * GET /users/:id
 */
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .populate('createdBy', 'firstName lastName email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    // Aggiunge statistiche dettagliate
    const contactsCount = await Contact.countByOwner(user._id);
    const recentContacts = await Contact.findByOwner(user._id, {})
      .limit(5)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        user: {
          ...user.toObject(),
          contactsCount,
          recentContacts
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero dell\'utente:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'ID utente non valido'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna utente (solo admin/manager)
 * PUT /users/:id
 */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Campi che solo gli admin possono modificare
    const adminOnlyFields = ['role', 'isActive'];
    const hasAdminFields = adminOnlyFields.some(field => updates.hasOwnProperty(field));
    
    if (hasAdminFields && !req.user.hasRole('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Solo gli amministratori possono modificare ruolo e stato account'
      });
    }

    // Rimuove campi che non dovrebbero essere aggiornati
    delete updates._id;
    delete updates.password;
    delete updates.createdBy;
    delete updates.stats;

    const user = await User.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    res.json({
      success: true,
      message: 'Utente aggiornato con successo',
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento dell\'utente:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Disattiva/Attiva utente
 * PUT /users/:id/toggle-status
 */
export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Non puoi disattivare il tuo stesso account'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `Utente ${user.isActive ? 'attivato' : 'disattivato'} con successo`,
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Errore nel cambio stato utente:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina utente (solo admin)
 * DELETE /users/:id
 */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Non puoi eliminare il tuo stesso account'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    // Verifica se l'utente ha contatti assegnati
    const contactCount = await Contact.countByOwner(id);
    if (contactCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Impossibile eliminare utente. Ha ${contactCount} contatti assegnati. Trasferisci prima i contatti ad altro utente.`,
        data: { contactCount }
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Utente eliminato con successo'
    });

  } catch (error) {
    console.error('Errore nell\'eliminazione dell\'utente:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Trasferisce tutti i contatti da un utente a un altro
 * POST /users/:fromUserId/transfer-contacts/:toUserId
 */
export const transferUserContacts = async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.params;

    // Verifica che entrambi gli utenti esistano
    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId),
      User.findById(toUserId)
    ]);

    if (!fromUser) {
      return res.status(404).json({
        success: false,
        message: 'Utente cedente non trovato'
      });
    }

    if (!toUser) {
      return res.status(404).json({
        success: false,
        message: 'Utente ricevente non trovato'
      });
    }

    if (!toUser.isActive) {
      return res.status(400).json({
        success: false,
        message: 'L\'utente ricevente deve essere attivo'
      });
    }

    // Esegue il trasferimento
    const transferResult = await Contact.transferOwnership(
      fromUserId,
      toUserId,
      req.user._id
    );

    // Aggiorna le statistiche degli utenti
    if (transferResult.transferredCount > 0) {
      await Promise.all([
        User.findByIdAndUpdate(fromUserId, {
          $inc: { 'stats.totalContacts': -transferResult.transferredCount }
        }),
        User.findByIdAndUpdate(toUserId, {
          $inc: { 'stats.totalContacts': transferResult.transferredCount }
        })
      ]);
    }

    res.json({
      success: true,
      message: `Trasferiti ${transferResult.transferredCount} contatti con successo`,
      data: transferResult
    });

  } catch (error) {
    console.error('Errore nel trasferimento contatti:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni statistiche generali utenti (solo admin/manager)
 * GET /users/stats
 */
export const getUsersStats = async (req, res) => {
  try {
    // Statistiche per ruolo
    const roleStats = await User.getStats();
    
    // Utenti registrati negli ultimi 30 giorni
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Utenti attivi (login negli ultimi 7 giorni)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const activeUsers = await User.countDocuments({
      'stats.lastLogin': { $gte: sevenDaysAgo },
      isActive: true
    });

    // Top 5 utenti per numero di contatti
    const topUsersByContacts = await User.aggregate([
      { $match: { isActive: true } },
      { $sort: { 'stats.totalContacts': -1 } },
      { $limit: 5 },
      { $project: { 
        firstName: 1, 
        lastName: 1, 
        email: 1, 
        role: 1,
        'stats.totalContacts': 1 
      }}
    ]);

    // Statistiche per dipartimento
    const departmentStats = await User.aggregate([
      { $match: { isActive: true, department: { $exists: true, $ne: null } } },
      { $group: { 
        _id: '$department', 
        count: { $sum: 1 },
        totalContacts: { $sum: '$stats.totalContacts' }
      }},
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers: await User.countDocuments(),
          activeUsers,
          recentUsers,
          totalContacts: await Contact.countDocuments()
        },
        roleStats,
        departmentStats,
        topUsersByContacts,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('Errore nel recupero statistiche utenti:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni lista utenti per assegnazione contatti
 * GET /users/for-assignment
 */
export const getUsersForAssignment = async (req, res) => {
  try {
    const { excludeRole } = req.query;
    
    const filter = { 
      isActive: true 
    };
    
    // Esclude viewer dalla lista se non specificato diversamente
    if (excludeRole !== 'false') {
      filter.role = { $ne: 'viewer' };
    }

    const users = await User.find(filter)
      .select('firstName lastName email role department stats.totalContacts')
      .sort({ firstName: 1, lastName: 1 });

    // Aggiunge il conteggio attuale dei contatti
    const usersWithCounts = await Promise.all(
      users.map(async (user) => {
        const currentContactsCount = await Contact.countByOwner(user._id);
        return {
          ...user.toObject(),
          currentContactsCount
        };
      })
    );

    res.json({
      success: true,
      data: {
        users: usersWithCounts
      }
    });

  } catch (error) {
    console.error('Errore nel recupero utenti per assegnazione:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Reset password utente (solo admin)
 * POST /users/:id/reset-password
 */
export const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nuova password deve essere di almeno 6 caratteri'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password resettata con successo'
    });

  } catch (error) {
    console.error('Errore nel reset password:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottiene le preferenze di visualizzazione tabella dell'utente corrente
 * GET /users/me/table-preferences
 */
export const getTablePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('settings.tablePreferences');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    res.json({
      success: true,
      data: {
        tablePreferences: user.settings?.tablePreferences || {
          contacts: {
            visibleColumns: ['Contact', 'Email', 'Phone', 'Owner', 'Lists', 'Created', 'Actions'],
            pageSize: 10
          }
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero preferenze tabella:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna le preferenze di visualizzazione tabella dell'utente corrente
 * PUT /users/me/table-preferences
 */
export const updateTablePreferences = async (req, res) => {
  try {
    const { tablePreferences } = req.body;

    // Validazione base delle preferenze
    if (!tablePreferences || !tablePreferences.contacts) {
      return res.status(400).json({
        success: false,
        message: 'Preferenze tabella non valide'
      });
    }

    const { visibleColumns, pageSize } = tablePreferences.contacts;

    // Validazione visibleColumns
    if (!Array.isArray(visibleColumns) || visibleColumns.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Almeno una colonna deve essere visibile'
      });
    }

    // Validazione pageSize
    if (pageSize && (typeof pageSize !== 'number' || pageSize < 5 || pageSize > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Il numero di righe per pagina deve essere tra 5 e 100'
      });
    }

    // Aggiorna le preferenze dell'utente
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          'settings.tablePreferences': tablePreferences
        }
      },
      { 
        new: true,
        runValidators: true
      }
    ).select('settings.tablePreferences');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    res.json({
      success: true,
      message: 'Preferenze tabella aggiornate con successo',
      data: {
        tablePreferences: user.settings.tablePreferences
      }
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento preferenze tabella:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 