// src/utils/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Wait for DB to init
const db = require('../config/database');

const seed = async () => {
  console.log('🌱 Seeding database...');

  // ─── USERS ────────────────────────────────────────────
  const adminId = uuidv4();
  const adminHash = await bcrypt.hash('admin123', 12);

  const tenant1Id = uuidv4();
  const tenant2Id = uuidv4();
  const tenant3Id = uuidv4();
  const tenant4Id = uuidv4();
  const maintId = uuidv4();
  const supportId = uuidv4();
  const tenantHash = await bcrypt.hash('tenant123', 12);

  const users = [
    [adminId, 'Admin Manager', 'admin@estatemanager.com', adminHash, 'admin', '+234 801 000 0001'],
    [maintId, 'Emeka Technician', 'maintenance@estatemanager.com', tenantHash, 'maintenance', '+234 801 000 0002'],
    [supportId, 'Amaka Support', 'support@estatemanager.com', tenantHash, 'support', '+234 801 000 0003'],
    [tenant1Id, 'Chidi Okafor', 'chidi@email.com', tenantHash, 'tenant', '+234 802 111 2222'],
    [tenant2Id, 'Ngozi Adeyemi', 'ngozi@email.com', tenantHash, 'tenant', '+234 803 222 3333'],
    [tenant3Id, 'Bello Ibrahim', 'bello@email.com', tenantHash, 'tenant', '+234 804 333 4444'],
    [tenant4Id, 'Funke Ojo', 'funke@email.com', tenantHash, 'tenant', '+234 805 444 5555'],
  ];

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, name, email, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)');
  users.forEach(u => insertUser.run(u));
  insertUser.finalize();

  // ─── PROPERTIES ──────────────────────────────────────
  const prop1 = uuidv4(), prop2 = uuidv4(), prop3 = uuidv4(), prop4 = uuidv4(),
        prop5 = uuidv4(), prop6 = uuidv4(), prop7 = uuidv4(), prop8 = uuidv4();

  const properties = [
    [prop1, 'A101', 'Block A', 1, 2, 1, 65.0, 150000, 'occupied', 'Modern 2-bedroom flat'],
    [prop2, 'A102', 'Block A', 1, 3, 2, 90.0, 220000, 'occupied', 'Spacious 3-bedroom'],
    [prop3, 'A201', 'Block A', 2, 1, 1, 45.0, 100000, 'vacant',   '1-bedroom studio'],
    [prop4, 'B101', 'Block B', 1, 2, 2, 75.0, 180000, 'occupied', 'Corner 2-bedroom'],
    [prop5, 'B102', 'Block B', 1, 3, 2, 100.0, 250000, 'occupied', 'Premium 3-bedroom'],
    [prop6, 'B201', 'Block B', 2, 2, 1, 65.0, 155000, 'vacant',   '2-bedroom flat'],
    [prop7, 'C101', 'Block C', 1, 4, 3, 130.0, 350000, 'maintenance', 'Penthouse 4-bedroom'],
    [prop8, 'C201', 'Block C', 2, 2, 2, 80.0, 190000, 'vacant',   'Corner 2-bedroom unit'],
  ];

  const insertProp = db.prepare('INSERT OR IGNORE INTO properties (id, unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  properties.forEach(p => insertProp.run(p));
  insertProp.finalize();

  // ─── LEASES ──────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const leases = [
    [uuidv4(), tenant1Id, prop1, '2024-01-01', nextYear, 150000, 300000],
    [uuidv4(), tenant2Id, prop2, '2024-03-01', nextYear, 220000, 440000],
    [uuidv4(), tenant3Id, prop4, '2023-12-01', nextYear, 180000, 360000],
    [uuidv4(), tenant4Id, prop5, '2024-06-01', nextYear, 250000, 500000],
  ];

  const insertLease = db.prepare('INSERT OR IGNORE INTO leases (id, tenant_id, property_id, start_date, end_date, monthly_rent, deposit) VALUES (?, ?, ?, ?, ?, ?, ?)');
  leases.forEach(l => insertLease.run(l));
  insertLease.finalize();

  // ─── BILLS ───────────────────────────────────────────
  const billData = [
    [uuidv4(), tenant1Id, prop1, 'Monthly Rent - June', 'June 2025 rent', 150000, today, 'paid', 'rent'],
    [uuidv4(), tenant1Id, prop1, 'Service Charge Q2',   'Q2 service charge', 15000,  today, 'paid', 'service'],
    [uuidv4(), tenant1Id, prop1, 'Monthly Rent - July', 'July 2025 rent', 150000, '2025-07-01', 'pending', 'rent'],
    [uuidv4(), tenant2Id, prop2, 'Monthly Rent - June', 'June 2025 rent', 220000, today, 'paid', 'rent'],
    [uuidv4(), tenant2Id, prop2, 'Electricity Bill',    'May electricity', 12500,  today, 'overdue', 'utility'],
    [uuidv4(), tenant2Id, prop2, 'Monthly Rent - July', 'July 2025 rent', 220000, '2025-07-01', 'pending', 'rent'],
    [uuidv4(), tenant3Id, prop4, 'Monthly Rent - June', 'June 2025 rent', 180000, today, 'pending', 'rent'],
    [uuidv4(), tenant3Id, prop4, 'Water Bill May',      'May water supply', 5000,  '2025-05-31', 'overdue', 'utility'],
    [uuidv4(), tenant4Id, prop5, 'Monthly Rent - June', 'June 2025 rent', 250000, today, 'paid', 'rent'],
    [uuidv4(), tenant4Id, prop5, 'Maintenance Fee',     'Gate system maint', 8000, today, 'pending', 'maintenance'],
  ];

  const insertBill = db.prepare('INSERT OR IGNORE INTO bills (id, tenant_id, property_id, title, description, amount, due_date, status, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  billData.forEach(b => {
    const withAdmin = [...b, adminId];
    // Set paid_at for paid bills
    insertBill.run(withAdmin);
  });
  insertBill.finalize();
  // Fix paid_at for paid bills
  db.run("UPDATE bills SET paid_at = datetime('now', '-5 days'), payment_method='bank_transfer' WHERE status='paid'");

  // ─── COMPLAINTS ──────────────────────────────────────
  const complaints = [
    [uuidv4(), tenant1Id, prop1, 'Leaking pipe in bathroom', 'The bathroom pipe has been leaking for 2 days. Water is pooling on the floor.', 'plumbing', 'high', 'open'],
    [uuidv4(), tenant2Id, prop2, 'Power fluctuation', 'Lights keep flickering, appliances getting damaged.', 'electrical', 'urgent', 'in_progress'],
    [uuidv4(), tenant3Id, prop4, 'Gate remote not working', 'My gate remote stopped responding after the rain.', 'security', 'medium', 'open'],
    [uuidv4(), tenant4Id, prop5, 'Noise complaint', 'Neighbors playing loud music after midnight.', 'general', 'medium', 'resolved'],
    [uuidv4(), tenant1Id, prop1, 'AC not cooling', 'Air conditioner running but not cooling the room.', 'hvac', 'medium', 'open'],
  ];

  const insertComp = db.prepare('INSERT OR IGNORE INTO complaints (id, tenant_id, property_id, title, description, category, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  complaints.forEach(c => insertComp.run(c));
  insertComp.finalize();

  // Assign maintenance to one complaint
  db.run(`UPDATE complaints SET assigned_to='${maintId}', status='in_progress' WHERE title='Power fluctuation'`);

  // ─── ACCESS CARDS ────────────────────────────────────
  const cards = [
    [uuidv4(), tenant1Id, 'NFC-001-CHI', 'nfc'],
    [uuidv4(), tenant1Id, 'PHY-101-001', 'physical'],
    [uuidv4(), tenant2Id, 'NFC-002-NGO', 'nfc'],
    [uuidv4(), tenant3Id, 'NFC-003-BEL', 'nfc'],
    [uuidv4(), tenant4Id, 'PHY-105-004', 'physical'],
  ];

  const insertCard = db.prepare('INSERT OR IGNORE INTO access_cards (id, tenant_id, card_number, type) VALUES (?, ?, ?, ?)');
  cards.forEach(c => insertCard.run(c));
  insertCard.finalize();

  // ─── VISITOR CODES ───────────────────────────────────
  db.run(`INSERT OR IGNORE INTO visitor_codes (id, tenant_id, code, visitor_name, visitor_phone, valid_from, valid_until, max_uses)
    VALUES ('${uuidv4()}', '${tenant1Id}', 'VIS001', 'John Visitor', '+234800000001', datetime('now'), datetime('now','+2 days'), 3)`);

  // ─── ACCESS LOGS ─────────────────────────────────────
  const logs = [
    [uuidv4(), tenant1Id, null, 'nfc', 'entry', 'granted'],
    [uuidv4(), tenant2Id, null, 'card', 'entry', 'granted'],
    [uuidv4(), tenant3Id, null, 'nfc', 'entry', 'granted'],
    [uuidv4(), null, null, 'card', 'entry', 'denied'],
  ];
  const insertLog = db.prepare("INSERT OR IGNORE INTO access_logs (id, person_id, card_id, access_type, direction, status) VALUES (?, ?, ?, ?, ?, ?)");
  logs.forEach(l => insertLog.run(l));
  insertLog.finalize();

  // ─── NOTIFICATIONS ───────────────────────────────────
  const notifs = [
    [uuidv4(), tenant1Id, 'Welcome!', 'Welcome to EstateManager. Your account is set up.', 'success'],
    [uuidv4(), tenant1Id, 'Bill Due', 'Your July rent of ₦150,000 is due on July 1.', 'payment'],
    [uuidv4(), tenant2Id, 'Overdue Bill', 'Your electricity bill of ₦12,500 is overdue.', 'error'],
    [uuidv4(), adminId, 'New Complaint', 'Urgent: Power fluctuation reported in A102.', 'error'],
  ];
  const insertNotif = db.prepare('INSERT OR IGNORE INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)');
  notifs.forEach(n => insertNotif.run(n));
  insertNotif.finalize();

  // ─── ACTIVITY LOGS ───────────────────────────────────
  const acts = [
    [uuidv4(), adminId,   'login',           'user', adminId,   'Admin logged in',           'success'],
    [uuidv4(), tenant1Id, 'login',           'user', tenant1Id, 'Tenant Chidi logged in',    'success'],
    [uuidv4(), adminId,   'create_tenant',   'user', tenant2Id, 'Tenant Ngozi onboarded',    'new_entry'],
    [uuidv4(), adminId,   'create_bill',     'bill', null,      'Bulk rent bills generated', 'new_entry'],
    [uuidv4(), tenant2Id, 'pay_bill',        'bill', null,      'Bill paid via bank_transfer','success'],
  ];
  const insertAct = db.prepare('INSERT OR IGNORE INTO activity_logs (id, user_id, action, entity_type, entity_id, details, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  acts.forEach(a => insertAct.run(a));
  insertAct.finalize();

  // ─── ANNOUNCEMENTS ───────────────────────────────────
  db.run(`INSERT OR IGNORE INTO announcements (id, title, content, type, target_audience, created_by)
    VALUES ('${uuidv4()}', 'Water Outage Notice', 'There will be a scheduled water outage on Saturday July 6, 2025 from 8AM-12PM for maintenance works.', 'maintenance', 'all', '${adminId}')`);
  db.run(`INSERT OR IGNORE INTO announcements (id, title, content, type, target_audience, created_by)
    VALUES ('${uuidv4()}', 'Estate AGM', 'Annual General Meeting is scheduled for July 20, 2025 at 3PM in the community hall. All tenants are required to attend.', 'event', 'all', '${adminId}')`);

  console.log('\n✅ Database seeded successfully!\n');
  console.log('═══════════════════════════════════════');
  console.log('  🔑 LOGIN CREDENTIALS');
  console.log('═══════════════════════════════════════');
  console.log('  Admin:       admin@estatemanager.com  / admin123');
  console.log('  Tenant 1:    chidi@email.com          / tenant123');
  console.log('  Tenant 2:    ngozi@email.com          / tenant123');
  console.log('  Tenant 3:    bello@email.com          / tenant123');
  console.log('  Maintenance: maintenance@estatemanager.com / tenant123');
  console.log('  Support:     support@estatemanager.com / tenant123');
  console.log('═══════════════════════════════════════\n');

  setTimeout(() => process.exit(0), 500);
};

setTimeout(seed, 1000); // Wait for DB tables to be created
