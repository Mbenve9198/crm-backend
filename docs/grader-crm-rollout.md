# Grader CRM integration

Requires the linked MenuChat v2 bootstrap and CRM frontend changes.

- Keep `INBOUND_LEAD_SECRET` equal to worker `CRM_INBOUND_SECRET`. New message/state/landing routes fail closed; legacy callers must include `X-Inbound-Secret` too.
- Run `node scripts/reconcileGraderCrm.js` to list candidate callbacks, ambiguous grader identities and preview-only contacted statuses. It logs IDs, never message content or phone numbers.
- Run it with `--apply-indexes` to install the three sparse unique indexes before accepting concurrent traffic. Resolve reported duplicate identities first. This does not edit commercial states.
- Apply v2 migration and worker before backend; frontend follows backend. Use the v2 reconciliation script to resubmit historical bookings and reconstruct retained conversations.
- Do not bulk-reset `contattato`: legacy preview activities omitted the previous status. Review the IDs in `previewStatusNeedsReview`, since existing manual contact attempts must be preserved.
- Production v2 emits `event=sync` with `status=preview_sent`. The audit matches this status in both the contact snapshot and historical onboarding activities, including contacts whose last event has changed. Candidate IDs still require checking both `calls` and `activities`, owner access and subsequent manual status changes before any reset.
- A replay of a known booking only enriches its details. Legacy callbacks without completion timestamps remain in `callbackCandidates` for review; replay never reopens a possibly completed callback.
- Imported v2 conversations are paused/read-only for CRM automation. They remain visible on the contact and are scoped to the contact's access permissions.
- The `propertyUpdates` field updates individual contact properties; it preserves simultaneous message/booking data. The old `properties` replacement remains for existing callers.
# Recupero approvato del 11 settembre 2026

`node scripts/recoverApprovedGraderLeads.js` esegue solo il controllo. `--apply`
ripristina i 37 ID approvati passati in `GRADER_CRM_RECOVERY_MANIFEST`, inclusi
i 9 con prenotazione. Il manifest è un array di `{leadId, booking?: {requestedAt,
scheduledAt}}`, con istanti UTC. Non inserire ID di produzione nel repository.

Il controllo richiede un contatto CRM univoco per ogni ID. Il reset e la relativa
attività con i valori precedenti sono atomici in una transazione MongoDB. Gli
owner restano invariati; tutti i contatti entrano nella lista
`Inbound - Grader recuperati`. Il report segnala owner inattivi o numeri non
chiamabili. Un marcatore persistente impedisce di ripetere il reset ai deploy
successivi, anche dopo modifiche manuali degli AE. Il batch rifiuta manifest diversi.

Il dialer espone la lista recuperata e mostra le prenotazioni con orario italiano;
l'auto-dial salta quelle future. Non viene avviata alcuna chiamata o messaggio
durante il recupero.

## Recupero email Smartlead — 19 settembre 2026

Il worker MenuChat importa prima il lead nella campagna dedicata e riconcilia
successivamente la history Smartlead. L'importazione non è un invio: il CRM viene
sincronizzato solo dopo un evento `SENT` con destinatario, sequenza e link corretti.
L'input sync per Smartlead deve avere `channel=email`, `deliveryStatus=sent`,
`provider=smartlead`, `providerCampaignId` e `providerLeadId` interi positivi,
oltre a `sentAt`, `providerMessageId` e URL report già richiesti.
Gli stati `queued`, `uncertain` e `failed` sono rifiutati con 400. Le chiamate
WhatsApp precedenti restano compatibili. Il segreto inbound è sempre obbligatorio.

I metadati provider sono salvati in `properties.graderRecovery`; source
`grader_abandoned`, lista `Posizione — recupero abbandoni` e stato `contattato`
non vengono creati per importazioni o invii incerti. Retry CRM e indice univoco su
`graderRecoveryId` restano indipendenti dall'invio e non fanno reinviare email.

Campagna dedicata Smartlead 3987276 in bozza con zero lead; campagna interna
3987294 in pausa dopo un solo invio confermato al destinatario interno Sendcloud
autorizzato, verificato `ok/1` da MillionVerifier. Evento `SENT` del
2026-09-19 alle 13:37:37.891 UTC, lead 4583736448. I precedenti destinatari catch-all
o esclusi da Smartlead non sono stati forzati.

Il recupero locale
è `sent` con `crmSyncedAt=null`: la modalità test non sincronizza production.
Il report dimostrativo HTTP localhost risponde 200 ma è correttamente rifiutato
dal validatore HTTPS del CRM. In un MongoDB temporaneo è stata verificata la sync
con i metadati dell'invio reale e un URL HTTPS fittizio: un solo contatto per due
richieste concorrenti, source/lista/stato corretti e metadati provider conservati.
Questa verifica non costituisce un collaudo completo del link pubblico.

L'utente conferma la ricezione della prima email nello spam e risponde; Smartlead
registra `REPLY` alle 14:03:10 UTC. L'inoltro delle 14:05:09 UTC a hello@menuchat.it
è accettato e la ricezione è confermata dall'utente. L'adapter MenuChat è corretto
per accettare l'ack reale `ok=true`, oltre a quello documentato `success=true`,
senza ripetere l'inoltro già effettuato (62 test MenuChat passati).

Il report dimostrativo HTTPS pubblico è stato aperto nel browser senza richiesta
di numero WhatsApp. La sync sul CRM isolato accetta questo URL e mantiene un solo
contatto dopo due richieste concorrenti. Il messaggio originale conteneva però
il vecchio URL localhost: la deliverability del messaggio finale resta da verificare.
L'utente ha accettato la firma già presente sulla casella durante l'autorizzazione
del rilascio tecnico. Suite dedicata: 75 test, incluso MongoDB; CI verde
run 35450417449 su dcb64ba.

Rilascio tecnico: PR #27 unita in `main` con commit `cc0c418f`; deployment Railway
`9cba224f-284a-4c97-b8eb-ee01c8a4d668` riuscito. Applicato l'indice unico sparse
`graderRecoveryId_1`, senza duplicati preesistenti e senza modificare contatti.
Controlli production: health 200, check anonimo 403, check autenticato 200,
sync accodata 400. Rimossi dai log di avvio i dettagli dell'URI MongoDB.
Recupero MenuChat `off`, inoltro automatico `false`, campagna operativa in bozza:
questo rilascio non abilita invii ai ristoranti.
Il runbook completo e la configurazione sono in `menuchat-v2/docs/grader-recovery.md`.
