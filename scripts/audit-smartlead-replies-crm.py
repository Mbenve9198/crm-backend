#!/usr/bin/env python3
"""Confronta risposte Smartlead (ultimi N giorni) vs presenza nel CRM."""
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import requests
from pymongo import MongoClient

POSITIVE_CATEGORY_NAMES = {"Interested", "Meeting Request"}
NEUTRAL_POSITIVE_NAMES = {"Information Request"}
ALL_POSITIVE = POSITIVE_CATEGORY_NAMES | NEUTRAL_POSITIVE_NAMES


def load_env():
    text = open("/Users/user/Documents/menuchat/crm-backend/.env.rtf").read()
    api_key = re.search(r'SMARTLEAD_API_KEY="([^"]+)"', text).group(1)
    mongo_uri = re.search(r'MONGODB_URI="([^"]+)"', text).group(1)
    return api_key, mongo_uri


def fetch_categories(api_key):
    r = requests.get(
        f"https://server.smartlead.ai/api/v1/leads/fetch-categories?api_key={api_key}",
        timeout=30,
    )
    r.raise_for_status()
    cats = r.json()
    by_id = {c["id"]: c["name"] for c in cats}
    by_name = {c["name"]: c["id"] for c in cats}
    return by_id, by_name


def fetch_all_replies(api_key, days=30):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    window = [
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    ]

    all_items = []
    offset = 0
    limit = 20

    while True:
        payload = {
            "offset": offset,
            "limit": limit,
            "filters": {
                "emailStatus": "Replied",
                "replyTimeBetween": window,
            },
            "sortBy": "REPLY_TIME_DESC",
        }
        r = requests.post(
            f"https://server.smartlead.ai/api/v1/master-inbox/inbox-replies?api_key={api_key}&fetch_message_history=false",
            json=payload,
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
        batch = data.get("data") or []
        if not batch:
            break
        all_items.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
        time.sleep(0.25)  # rate limit gentile

    return all_items, start, end


def normalize_email(email):
    return (email or "").strip().lower()


def check_crm(db, email, lead_id):
    contact = db.contacts.find_one(
        {"email": normalize_email(email)},
        {
            "_id": 1,
            "name": 1,
            "email": 1,
            "source": 1,
            "status": 1,
            "owner": 1,
            "properties.smartlead_lead_id": 1,
            "properties.smartlead_campaign_id": 1,
            "createdAt": 1,
            "updatedAt": 1,
        },
    )
    if not contact:
        return {"present": False}

    owner_email = None
    if contact.get("owner"):
        owner = db.users.find_one({"_id": contact["owner"]}, {"email": 1})
        owner_email = owner.get("email") if owner else None

    props = contact.get("properties") or {}
    sl_lead_id = str(props.get("smartlead_lead_id") or "")
    lead_id_match = sl_lead_id == str(lead_id) if lead_id else None

    activity_count = db.activities.count_documents({"contact": contact["_id"]})

    return {
        "present": True,
        "id": str(contact["_id"]),
        "name": contact.get("name"),
        "source": contact.get("source"),
        "status": contact.get("status"),
        "owner": owner_email,
        "smartlead_lead_id": sl_lead_id or None,
        "lead_id_match": lead_id_match,
        "activities": activity_count,
        "createdAt": contact.get("createdAt"),
    }


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    api_key, mongo_uri = load_env()
    cat_by_id, cat_by_name = fetch_categories(api_key)

    positive_ids = {cat_by_name[n] for n in POSITIVE_CATEGORY_NAMES if n in cat_by_name}
    neutral_ids = {cat_by_name[n] for n in NEUTRAL_POSITIVE_NAMES if n in cat_by_name}

    replies, start, end = fetch_all_replies(api_key, days=days)
    db = MongoClient(mongo_uri)["test"]

    # Dedup per email (teniamo la reply più recente)
    by_email = {}
    for item in replies:
        email = normalize_email(item.get("lead_email"))
        if not email:
            continue
        prev = by_email.get(email)
        if not prev or (item.get("last_reply_time") or "") > (prev.get("last_reply_time") or ""):
            by_email[email] = item

    unique_replies = list(by_email.values())

    category_counts = Counter()
    for item in unique_replies:
        cid = item.get("lead_category_id")
        category_counts[cat_by_id.get(cid, f"uncategorized ({cid})")] += 1

    positive = []
    neutral_pos = []
    other = []

    for item in unique_replies:
        cid = item.get("lead_category_id")
        cname = cat_by_id.get(cid)
        row = {
            "email": normalize_email(item.get("lead_email")),
            "name": " ".join(
                filter(None, [item.get("lead_first_name"), item.get("lead_last_name")])
            ).strip(),
            "category": cname or "Uncategorized",
            "category_id": cid,
            "last_reply_time": item.get("last_reply_time"),
            "campaign": item.get("email_campaign_name"),
            "campaign_id": item.get("email_campaign_id"),
            "lead_id": item.get("email_lead_id"),
        }
        if cid in positive_ids:
            positive.append(row)
        elif cid in neutral_ids:
            neutral_pos.append(row)
        else:
            other.append(row)

    def audit_rows(rows):
        in_crm = []
        missing = []
        for row in rows:
            crm = check_crm(db, row["email"], row["lead_id"])
            row["crm"] = crm
            if crm["present"]:
                in_crm.append(row)
            else:
                missing.append(row)
        return in_crm, missing

    pos_in, pos_missing = audit_rows(positive)
    neu_in, neu_missing = audit_rows(neutral_pos)

    print("=" * 70)
    print(f"AUDIT SMARTLEAD → CRM | ultimi {days} giorni")
    print(f"Finestra: {start.date()} → {end.date()}")
    print("=" * 70)
    print(f"\nRisposte totali (thread unici per email): {len(unique_replies)}")
    print("\nPer categoria Smartlead:")
    for name, n in category_counts.most_common():
        print(f"  - {name}: {n}")

    print("\n--- POSITIVE (Interested + Meeting Request) ---")
    print(f"Totale: {len(positive)}")
    print(f"  ✅ Nel CRM: {len(pos_in)}")
    print(f"  ❌ Assenti dal CRM: {len(pos_missing)}")

    if pos_missing:
        print("\n  Mancanti nel CRM:")
        for r in sorted(pos_missing, key=lambda x: x["last_reply_time"] or "", reverse=True):
            print(
                f"    • {r['email']:40} | {r['name'][:30]:30} | "
                f"{r['category']:18} | reply {str(r['last_reply_time'])[:10]} | "
                f"{r['campaign'][:35]}"
            )

    if pos_in:
        print("\n  Presenti ma da verificare (source non smartlead o lead_id diverso):")
        flagged = [
            r for r in pos_in
            if r["crm"].get("source") != "smartlead_outbound"
            or r["crm"].get("lead_id_match") is False
        ]
        if not flagged:
            print("    (nessuno — tutti ok)")
        for r in flagged:
            c = r["crm"]
            print(
                f"    • {r['email']:40} | source={c.get('source')} | "
                f"status={c.get('status')} | lead_id_match={c.get('lead_id_match')} | "
                f"owner={c.get('owner') or '—'}"
            )

    print("\n--- NEUTRAL-POSITIVE (Information Request) ---")
    print(f"Totale: {len(neutral_pos)} | CRM: {len(neu_in)} | Mancanti: {len(neu_missing)}")
    if neu_missing:
        for r in neu_missing[:10]:
            print(f"    • {r['email']} | {r['name']} | {r['last_reply_time'][:10]}")

    # JSON export for reference
    out = {
        "window": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
        "totals": {
            "all_replies_unique": len(unique_replies),
            "positive": len(positive),
            "positive_in_crm": len(pos_in),
            "positive_missing": len(pos_missing),
        },
        "positive_missing": pos_missing,
        "positive_in_crm": pos_in,
        "category_counts": dict(category_counts),
    }
    out_path = "/Users/user/Documents/menuchat/crm-backend/scripts/smartlead-crm-audit.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\n📄 Report JSON: {out_path}")


if __name__ == "__main__":
    main()
