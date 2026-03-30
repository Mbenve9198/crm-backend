import mongoose from 'mongoose';

const MONGODB_URI = "mongodb+srv://marco:GDFKsRoislGkxAf8@crm-menuchat.pirhts7.mongodb.net/?retryWrites=true&w=majority&appName=crm-menuchat";

const activeStatuses = [
  'da contattare', 'contattato', 'da richiamare', 'interessato',
  'ghosted/bad timing', 'qr code inviato', 'free trial iniziato'
];

async function run() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({}, { projection: { name: 1, email: 1, role: 1 } }).toArray();
  console.log('Utenti disponibili:');
  users.forEach(u => console.log(`  ${u._id} | ${u.name || '(no name)'} | ${u.email} | ${u.role}`));

  const marco = await db.collection('users').findOne({ email: 'marco@menuchat.com' });
  if (!marco) {
    console.log('marco@menuchat.com non trovato!');
    await mongoose.disconnect();
    return;
  }
  console.log(`\nUsando utente: ${marco._id} (${marco.email})`);

  const totalContacts = await db.collection('contacts').countDocuments({ owner: marco._id });
  console.log(`\nTotale contatti assegnati a Marco: ${totalContacts}`);

  const statusBreakdown = await db.collection('contacts').aggregate([
    { $match: { owner: marco._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log('\nBreakdown per status:');
  statusBreakdown.forEach(s => {
    const isActive = activeStatuses.includes(s._id);
    console.log(`  ${s._id}: ${s.count} ${isActive ? '(ACTIVE)' : '(INACTIVE)'}`);
  });

  const smartleadContacts = await db.collection('contacts').aggregate([
    { $match: { owner: marco._id, source: 'smartlead_outbound' } },
    {
      $lookup: {
        from: 'activities',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] }, 'data.kind': { $ne: 'reactivation' } } },
          { $group: { _id: '$contact', count: { $sum: 1 } } }
        ],
        as: 'acts'
      }
    },
    {
      $addFields: {
        activitiesCount: { $ifNull: [{ $arrayElemAt: ['$acts.count', 0] }, 0] }
      }
    },
    {
      $addFields: {
        isNotTouched: { $lte: ['$activitiesCount', 1] },
        isActiveStatus: { $in: ['$status', activeStatuses] }
      }
    },
    {
      $group: {
        _id: { status: '$status', isNotTouched: '$isNotTouched', isActiveStatus: '$isActiveStatus' },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log('\nSmartlead outbound - breakdown (status / isNotTouched / isActiveStatus):');
  let totalUntouched = 0;
  let totalUntouchedActive = 0;
  smartleadContacts.forEach(s => {
    console.log(`  ${s._id.status} | notTouched=${s._id.isNotTouched} | active=${s._id.isActiveStatus} -> ${s.count}`);
    if (s._id.isNotTouched) totalUntouched += s.count;
    if (s._id.isNotTouched && s._id.isActiveStatus) totalUntouchedActive += s.count;
  });
  console.log(`\n  Totale untouched (senza filtro active): ${totalUntouched}`);
  console.log(`  Totale untouched (con filtro active): ${totalUntouchedActive}`);

  const rcContacts = await db.collection('contacts').aggregate([
    { $match: { owner: marco._id, source: 'inbound_rank_checker' } },
    {
      $lookup: {
        from: 'activities',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] }, 'data.kind': { $ne: 'reactivation' } } },
          { $group: { _id: '$contact', count: { $sum: 1 } } }
        ],
        as: 'acts'
      }
    },
    {
      $addFields: {
        activitiesCount: { $ifNull: [{ $arrayElemAt: ['$acts.count', 0] }, 0] }
      }
    },
    {
      $addFields: {
        isNotTouched: { $eq: ['$activitiesCount', 0] },
        isActiveStatus: { $in: ['$status', activeStatuses] }
      }
    },
    {
      $group: {
        _id: { status: '$status', isNotTouched: '$isNotTouched', isActiveStatus: '$isActiveStatus' },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log('\nRank Checker - breakdown (status / isNotTouched / isActiveStatus):');
  let rcUntouched = 0;
  let rcUntouchedActive = 0;
  rcContacts.forEach(s => {
    console.log(`  ${s._id.status} | notTouched=${s._id.isNotTouched} | active=${s._id.isActiveStatus} -> ${s.count}`);
    if (s._id.isNotTouched) rcUntouched += s.count;
    if (s._id.isNotTouched && s._id.isActiveStatus) rcUntouchedActive += s.count;
  });
  console.log(`\n  Totale untouched (senza filtro active): ${rcUntouched}`);
  console.log(`  Totale untouched (con filtro active): ${rcUntouchedActive}`);

  console.log(`\n--- TOTALE UNTOUCHED ---`);
  console.log(`Senza filtro isActiveStatus: ${totalUntouched + rcUntouched}`);
  console.log(`Con filtro isActiveStatus:    ${totalUntouchedActive + rcUntouchedActive}`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
