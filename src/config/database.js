'use strict';
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/estate.db';
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(path.resolve(DB_PATH), (err) => {
  if (err) { console.error('❌ DB error:', err.message); process.exit(1); }
  console.log('✅ Connected to SQLite at', path.resolve(DB_PATH));
});

// Safe column migration helper
const addCol = (table, col, def) => {
  db.all(`PRAGMA table_info(${table})`, [], (err, cols) => {
    if (err || !cols) return;
    if (!cols.some(c => c.name === col)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`, [], (e) => {
        if (!e) console.log(`✅ Migration: ${table}.${col} added`);
      });
    }
  });
};

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL, phone TEXT, avatar TEXT,
    is_active INTEGER DEFAULT 1, onboarding_status TEXT DEFAULT 'pending',
    last_login TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`, [], () => {
    addCol('users', 'onboarding_status', "TEXT DEFAULT 'pending'");
    addCol('users', 'avatar', 'TEXT');
    addCol('users', 'is_active', 'INTEGER DEFAULT 1');
  });

  db.run(`CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY, unit_number TEXT UNIQUE NOT NULL, block TEXT, floor INTEGER,
    bedrooms INTEGER DEFAULT 1, bathrooms INTEGER DEFAULT 1, size_sqft REAL,
    rent_amount REAL NOT NULL, status TEXT DEFAULT 'vacant',
    description TEXT, amenities TEXT, images TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`, [], () => {
    // Migrate existing properties table — this is the fix for the 500 error
    addCol('properties', 'amenities', 'TEXT');
    addCol('properties', 'images', 'TEXT');
    addCol('properties', 'updated_at', "TEXT DEFAULT (datetime('now'))");
  });

  db.run(`CREATE TABLE IF NOT EXISTS kyc_applications (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, property_id TEXT,
    tenant_type TEXT DEFAULT 'individual', status TEXT DEFAULT 'pending',
    full_name TEXT, date_of_birth TEXT, gender TEXT, nationality TEXT,
    marital_status TEXT, occupation TEXT, employer TEXT, residential_address TEXT,
    nok_name TEXT, nok_relationship TEXT, nok_phone TEXT, nok_email TEXT, nok_address TEXT,
    guarantor_name TEXT, guarantor_phone TEXT, guarantor_address TEXT,
    guarantor_id_type TEXT, guarantor_employment TEXT,
    emergency_name TEXT, emergency_phone TEXT, emergency_relationship TEXT,
    vehicle_plate TEXT, vehicle_reg TEXT, num_occupants INTEGER DEFAULT 1, pet_info TEXT,
    company_name TEXT, company_tin TEXT, company_reg TEXT, authorized_signatory TEXT,
    id_document TEXT, proof_of_address TEXT, passport_photo TEXT,
    employment_docs TEXT, guarantor_docs TEXT,
    admin_notes TEXT, reviewed_by TEXT, reviewed_at TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id),
    FOREIGN KEY(property_id) REFERENCES properties(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS leases (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, property_id TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    monthly_rent REAL NOT NULL, deposit REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id), FOREIGN KEY(property_id) REFERENCES properties(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, property_id TEXT,
    title TEXT NOT NULL, description TEXT, amount REAL NOT NULL, due_date TEXT NOT NULL,
    status TEXT DEFAULT 'pending', category TEXT DEFAULT 'rent',
    paid_at TEXT, payment_method TEXT, transaction_ref TEXT,
    paystack_ref TEXT, paystack_status TEXT, created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`, [], () => {
    addCol('bills', 'paystack_ref', 'TEXT');
    addCol('bills', 'paystack_status', 'TEXT');
  });

  db.run(`CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, property_id TEXT,
    title TEXT NOT NULL, description TEXT NOT NULL, category TEXT DEFAULT 'general',
    priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open',
    assigned_to TEXT, resolution_notes TEXT, images TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), resolved_at TEXT,
    FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT,
    complaint_id TEXT, content TEXT NOT NULL, is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(sender_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS access_cards (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, card_number TEXT UNIQUE NOT NULL,
    card_uid TEXT, type TEXT DEFAULT 'physical', status TEXT DEFAULT 'active',
    hardware_device_id TEXT, last_used TEXT,
    created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`, [], () => {
    addCol('access_cards', 'card_uid', 'TEXT');
    addCol('access_cards', 'hardware_device_id', 'TEXT');
    addCol('access_cards', 'last_used', 'TEXT');
  });

  db.run(`CREATE TABLE IF NOT EXISTS nfc_devices (
    id TEXT PRIMARY KEY, device_name TEXT NOT NULL, device_type TEXT DEFAULT 'reader',
    location TEXT, ip_address TEXT, port INTEGER DEFAULT 8080, api_key TEXT,
    status TEXT DEFAULT 'online', last_heartbeat TEXT, firmware_version TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS visitor_codes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    visitor_name TEXT, visitor_phone TEXT, visitor_email TEXT,
    valid_from TEXT NOT NULL, valid_until TEXT NOT NULL,
    max_uses INTEGER DEFAULT 1, used_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
    whatsapp_sent INTEGER DEFAULT 0, email_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(tenant_id) REFERENCES users(id)
  )`, [], () => {
    addCol('visitor_codes', 'visitor_email', 'TEXT');
    addCol('visitor_codes', 'whatsapp_sent', 'INTEGER DEFAULT 0');
    addCol('visitor_codes', 'email_sent', 'INTEGER DEFAULT 0');
  });

  db.run(`CREATE TABLE IF NOT EXISTS access_logs (
    id TEXT PRIMARY KEY, person_id TEXT, card_id TEXT,
    visitor_code_id TEXT, device_id TEXT, access_type TEXT,
    direction TEXT, status TEXT DEFAULT 'granted', notes TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`, [], () => { addCol('access_logs', 'device_id', 'TEXT'); });

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
    message TEXT NOT NULL, type TEXT DEFAULT 'info', is_read INTEGER DEFAULT 0,
    link TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, details TEXT, ip_address TEXT,
    status TEXT DEFAULT 'success', created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    type TEXT DEFAULT 'general', target_audience TEXT DEFAULT 'all',
    is_active INTEGER DEFAULT 1, created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')), expires_at TEXT
  )`);

  console.log('✅ All database tables ready');
});

module.exports = db;
