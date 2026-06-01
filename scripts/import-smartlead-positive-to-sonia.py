#!/usr/bin/env python3
"""Importa i 11 lead Smartlead positive mancanti → CRM, owner Sonia, nota timeline."""
import json
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bson import ObjectId
from pymongo import MongoClient

HIGH_CONFIDENCE_EMAILS = [
    "info@osterialacapannina.it",
    "info@santamonaca.it",
    "info@countryhouseperbacco.it",
    "info@trattorialabarcaccia.com",
    "info@agriturismocortearagonese.it",
    "info@osteriaerbaluce.it",
    "info@amarmio.it",
    "info@agriturismobiomarche.it",
    "info@altrochevino.com",
    "info@aisettenani.it",
    "info@bamragusa.com",
]

SONIA_EMAIL = "sonia@menuchat.it"


def load_env():
    text = open("/Users/user/Documents/menuchat/crm-backend/.env.rtf").read()
    return {
        "smartlead": re.search(r'SMARTLEAD_API_KEY="([^"]+)"', text).group(1),
        "mongo": re.search(r'MONGODB_URI="([^"]+)"', text).group(1),
    }


def extract_lead_reply_only(text):
    if not text:
        return ""
    cut_patterns = [
        r"\sIl giorno\s+\w",
        r"\sOn\s+\w{3},\s+\w",
        r"\sDa:\s",
        r"\sInviato:\s",
        r"\sFrom:\s",
        r"\s>+\s",
    ]
    cleaned = text
    for pat in cut_patterns:
        m = re.search(pat, cleaned, re.I)
        if m:
            cleaned = cleaned[: m.start()]
    return re.sub(r"\s+", " ", cleaned).strip()[:900]


def extract_phone(text):
    patterns = [
        r"(?:chiami|chiamatemi|cellulare|cell\.?|tel\.?|numero)[^\d+]{0,20}(\+?39?\s?\d[\d\s.\-]{7,14}\d)",
        r"(\+39\s?\d{2,3}[\s.\-]?\d{6,8})",
        r"(3\d{2}[\s.\-]?\d{6,7})",
        r"(0\d{1,4}[\s.\-]?\d{5,8})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            num = re.sub(r"[\s.\-]", "", m.group(1))
            if num.startswith("39") and not num.startswith("+"):
                num = "+" + num
            elif num.startswith("3") or num.startswith("0"):
                num = "+39" + num.lstrip("0") if num.startswith("3") else "+39" + num
            if len(re.sub(r"\D", "", num)) >= 9:
                return num
    return None


def fetch_smartlead_lead(api_key, email):
    r = requests.get(
        f"https://server.smartlead.ai/api/v1/leads/?api_key={api_key}&email={requests.utils.quote(email)}",
        timeout=30,
    )
    if r.status_code != 200:
        return None
    data = r.json()
    return data if data.get("email") else None


def build_note_description(row, lead_reply):
    reply_date = (row.get("last_reply_time") or "")[:10]
    return (
        "Lead importato da audit Smartlead (risposta positiva non categorizzata, non passata dal webhook CRM).\n\n"
        f"Campagna: {row.get('campaign', 'N/A')}\n"
        f"Data risposta: {reply_date}\n"
        f"Classificazione: INTERESTED — {row.get('reason', 'interesse esplicito')}\n\n"
        "Cosa ha scritto il lead:\n"
        f"{lead_reply}\n\n"
        "Azione suggerita: contattare al più presto — il lead ha già mostrato interesse via email outbound."
    )


def main():
    execute = "--execute" in sys.argv
    env = load_env()
    db = MongoClient(env["mongo"])["test"]

    audit = json.load(
        open("/Users/user/Documents/menuchat/crm-backend/scripts/uncategorized-classification.json")
    )
    rows_by_email = {r["email"]: r for r in audit["all_rows"] if r["email"] in HIGH_CONFIDENCE_EMAILS}

    sonia = db.users.find_one({"email": SONIA_EMAIL})
    if not sonia:
        print(f"❌ Utente {SONIA_EMAIL} non trovato")
        sys.exit(1)
    sonia_id = sonia["_id"]

    admin = db.users.find_one({"email": "marco@menuchat.com"}) or sonia
    admin_id = admin["_id"]

    print(f"Import previsto: {len(HIGH_CONFIDENCE_EMAILS)} lead → {SONIA_EMAIL}\n")

    for email in HIGH_CONFIDENCE_EMAILS:
        row = rows_by_email.get(email)
        if not row:
            print(f"⚠️  {email}: non trovato nel report audit")
            continue

        existing = db.contacts.find_one({"email": email})
        if existing:
            print(f"⏭️  {email}: già presente nel CRM (owner={existing.get('owner')})")
            continue

        lead_reply = extract_lead_reply_only(row.get("reply_text", ""))
        phone_from_reply = extract_phone(row.get("reply_text", ""))

        sl = fetch_smartlead_lead(env["smartlead"], email)
        time.sleep(0.2)

        name = row.get("name") or "Lead Smartlead"
        phone = phone_from_reply
        properties = {
            "smartlead_imported_at": datetime.now(timezone.utc).isoformat(),
            "smartlead_import_source": "uncategorized_audit_2026-06-01",
            "smartlead_lead_id": str(row.get("lead_id") or ""),
            "smartlead_campaign_name": row.get("campaign"),
        }

        if sl:
            name = sl.get("company_name") or name
            if not phone and sl.get("phone_number"):
                phone = sl.get("phone_number")
            cf = sl.get("custom_fields") or {}
            if cf.get("rating_prospect"):
                properties["rating"] = cf.get("rating_prospect")
            if cf.get("reviews_prospect"):
                properties["reviews_count"] = cf.get("reviews_prospect")
            if sl.get("website"):
                properties["site"] = sl.get("website")
            if sl.get("location"):
                properties["location"] = sl.get("location")
            lcd = sl.get("lead_campaign_data") or []
            if lcd and isinstance(lcd, list):
                properties["smartlead_campaign_id"] = lcd[0].get("campaign_id")
            properties["smartlead_lead_id"] = str(sl.get("id") or row.get("lead_id") or "")

        note_title = "📋 Lead Smartlead — risposta positiva (contesto)"
        note_desc = build_note_description(row, lead_reply)

        email_activity = {
            "type": "email",
            "title": "✨ Risposta email Smartlead — INTERESSATO",
            "description": (
                f"Campagna: {row.get('campaign')}\n\n"
                f"Risposta del lead ({str(row.get('last_reply_time', ''))[:10]}):\n"
                f"{lead_reply}"
            ),
            "data": {
                "origin": "smartlead",
                "kind": "inbound_reply",
                "campaignName": row.get("campaign"),
                "campaignId": str(properties.get("smartlead_campaign_id") or ""),
                "replyText": lead_reply[:2000],
                "repliedAt": row.get("last_reply_time"),
                "aiClassification": {
                    "category": "INTERESTED",
                    "confidence": 0.95,
                    "reason": row.get("reason", "Audit uncategorized"),
                },
            },
        }

        contact_doc = {
            "name": name,
            "email": email,
            "phone": phone,
            "lists": ["Smartlead Outbound Email"],
            "status": "interessato",
            "mrr": 0,
            "source": "smartlead_outbound",
            "properties": properties,
            "owner": sonia_id,
            "createdBy": admin_id,
            "lastModifiedBy": sonia_id,
            "isActive": True,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }

        print(f"• {email}")
        print(f"  Nome: {name}")
        print(f"  Tel: {phone or '—'}")
        print(f"  Nota: {lead_reply[:100]}...")

        if not execute:
            continue

        ins = db.contacts.insert_one(contact_doc)
        cid = ins.inserted_id

        db.activities.insert_one({
            "contact": cid,
            "type": "note",
            "title": note_title,
            "description": note_desc,
            "data": {"origin": "manual", "kind": "import_context", "meta": {"importedBy": "audit_script"}},
            "createdBy": sonia_id,
            "status": "completed",
            "priority": "high",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        })

        db.activities.insert_one({
            "contact": cid,
            "type": email_activity["type"],
            "title": email_activity["title"],
            "description": email_activity["description"],
            "data": email_activity["data"],
            "createdBy": sonia_id,
            "status": "completed",
            "priority": "high",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        })

        print(f"  ✅ Creato contatto {cid} + 2 activities")

    if not execute:
        print("\n⚠️  DRY-RUN. Usa --execute per importare.")
        return

    total = db.contacts.count_documents({"owner": sonia_id})
    print(f"\n✅ Completato. Lead totali di Sonia: {total}")


if __name__ == "__main__":
    main()
