// src/config/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/estate.db';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('❌ DB error:', err.message); process.exit(1); }
  console.log('✅ Connected to SQLite database');
});

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','tenant','maintenance','support')),
    phone TEXT, avatar TEXT, is_active INTEGER DEFAULT 1,
    onboarding_status TEXT DEFAULT 'pending' CHECK(onboarding_status IN ('pending','kyc_submitted','kyc_approved','kyc_rejected','active')),
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    unit_number TEXT UNIQUE NOT NULL,
    block TEXT, floor INTEGER,
    bedrooms INTEGER DEFAULT 1, bathrooms INTEGER DEFAULT 1,
    size_sqft REAL, rent_amount REAL NOT NULL,
    status TEXT DEFAULT 'vacant' CHECK(status IN ('occupied','vacant','maintenance')),
    description TEXT, amenities TEXT, images TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS kyc_applications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    property_id TEXT,
    tenant_type TEXT DEFAULT 'individual' CHECK(tenant_type IN ('individual','corporate')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','under_review','approved','rejected')),
    -- Personal Info
    full_name TEXT, date_of_birth TEXT, gender TEXT, nationality TEXT,
    marital_status TEXT, occupation TEXT, employer TEXT,
    residential_address TEXT,
    -- Next of Kin
    nok_name TEXT, nok_relationship TEXT, nok_phone TEXT,
    nok_email TEXT, nok_address TEXT,
    -- Guarantor
    guarantor_name TEXT, guarantor_phone TEXT,
    guarantor_address TEXT, guarantor_id_type TEXT,
    guarantor_employment TEXT,
    -- Emergency Contact
    emergency_name TEXT, emergency_phone TEXT, emergency_relationship TEXT,
    -- Estate-specific
    vehicle_plate TEXT, vehicle_reg TEXT,
    num_occupants INTEGER DEFAULT 1,
    pet_info TEXT,
    -- Corporate fields
    company_name TEXT, company_tin TEXT, company_reg TEXT, authorized_signatory TEXT,
    -- Uploaded doc paths (JSON arrays)
    id_document TEXT, proof_of_address TEXT, passport_photo TEXT,
    employment_docs TEXT, guarantor_docs TEXT,
    -- Review
    admin_notes TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id),
    FOREIGN KEY(property_id) REFERENCES properties(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS leases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    monthly_rent REAL NOT NULL, deposit REAL DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','terminated')),
    document_url TEXT, signed_rules INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id),
    FOREIGN KEY(property_id) REFERENCES properties(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL, property_id TEXT,
    title TEXT NOT NULL, description TEXT,
    amount REAL NOT NULL, due_date TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','overdue','cancelled')),
    category TEXT DEFAULT 'rent' CHECK(category IN ('rent','utility','maintenance','service','deposit','other')),
    paid_at TEXT, payment_method TEXT, transaction_ref TEXT,
    paystack_ref TEXT, paystack_status TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id),
    FOREIGN KEY(property_id) REFERENCES properties(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL, property_id TEXT,
    title TEXT NOT NULL, description TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
    status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    assigned_to TEXT, resolution_notes TEXT, images TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY(tenant_id) REFERENCES users(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL, receiver_id TEXT, complaint_id TEXT,
    content TEXT NOT NULL, is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(sender_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS access_cards (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    card_number TEXT UNIQUE NOT NULL,
    card_uid TEXT UNIQUE,
    type TEXT DEFAULT 'physical' CHECK(type IN ('physical','nfc','virtual')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','suspended')),
    hardware_device_id TEXT,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS nfc_devices (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT DEFAULT 'reader' CHECK(device_type IN ('reader','controller','gate')),
    location TEXT,
    ip_address TEXT, port INTEGER DEFAULT 8080,
    api_key TEXT,
    status TEXT DEFAULT 'online' CHECK(status IN ('online','offline','error')),
    last_heartbeat TEXT,
    firmware_version TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS visitor_codes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    visitor_name TEXT, visitor_phone TEXT,
    valid_from TEXT NOT NULL, valid_until TEXT NOT NULL,
    max_uses INTEGER DEFAULT 1, used_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS access_logs (
    id TEXT PRIMARY KEY,
    person_id TEXT, card_id TEXT, visitor_code_id TEXT,
    device_id TEXT,
    access_type TEXT CHECK(access_type IN ('card','nfc','visitor_code','manual','pin')),
    direction TEXT CHECK(direction IN ('entry','exit')),
    status TEXT DEFAULT 'granted' CHECK(status IN ('granted','denied')),
    notes TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL, message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK(type IN ('info','warning','success','error','payment','maintenance','kyc')),
    is_read INTEGER DEFAULT 0, link TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, details TEXT, ip_address TEXT,
    status TEXT DEFAULT 'success' CHECK(status IN ('success','pending','failed','new_entry')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL, content TEXT NOT NULL,
    type TEXT DEFAULT 'general', target_audience TEXT DEFAULT 'all',
    is_active INTEGER DEFAULT 1, created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')), expires_at TEXT
  )`);

  console.log('✅ All database tables initialized');
});

module.exports = db;
