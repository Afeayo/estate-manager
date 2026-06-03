// src/utils/seed.js
'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const run = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, err => err ? rej(err) : res()));

const get = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));

async function seed() {
  // Skip if already seeded
  const existing = await get("SELECT id FROM users WHERE email='admin@estatemanager.com'");
  if (existing) {
    console.log('✅ Database already seeded — skipping');
    process.exit(0);
    return;
  }

  console.log('🌱 Seeding database...');

  const adminHash = await bcrypt.hash('admin123', 12);
  const staffHash = await bcrypt.hash('tenant123', 12);

  const adminId   = uuidv4();
  const maintId   = uuidv4();
  const supportId = uuidv4();
  const t1Id = uuidv4(), t2Id = uuidv4(), t3Id = uuidv4(), t4Id = uuidv4();

  // ── Users ──────────────────────────────────────────────
  const users = [
    [adminId,   'Admin Manager',    'admin@estatemanager.com',          adminHash,  'admin',       '+234 801 000 0001', 'active'],
    [maintId,   'Emeka Technician', 'maintenance@estatemanager.com',    staffHash,  'maintenance', '+234 801 000 0002', 'active'],
    [supportId, 'Amaka Support',    'support@estatemanager.com',        staffHash,  'support',     '+234 801 000 0003', 'active'],
    [t1Id,      'Chidi Okafor',     'chidi@email.com',                  staffHash,  'tenant',      '+234 802 111 2222', 'active'],
    [t2Id,      'Ngozi Adeyemi',    'ngozi@email.com',                  staffHash,  'tenant',      '+234 803 222 3333', 'active'],
    [t3Id,      'Bello Ibrahim',    'bello@email.com',                  staffHash,  'tenant',      '+234 804 333 4444', 'active'],
    [t4Id,      'Funke Ojo',        'funke@email.com',                  staffHash,  'tenant',      '+234 805 444 5555', 'active'],
  ];
  for (const u of users) {
    await run(
      'INSERT INTO users (id,name,email,password,role,phone,onboarding_status) VALUES (?,?,?,?,?,?,?)',
      u
    );
  }

  // ── Properties ─────────────────────────────────────────
  const p1=uuidv4(), p2=uuidv4(), p3=uuidv4(), p4=uuidv4();
  const p5=uuidv4(), p6=uuidv4(), p7=uuidv4(), p8=uuidv4();
  const props = [
    [p1,'A101','Block A',1,2,1,65,150000,'occupied','Modern 2-bedroom flat'],
    [p2,'A102','Block A',1,3,2,90,220000,'occupied','Spacious 3-bedroom'],
    [p3,'A201','Block A',2,1,1,45,100000,'vacant',  '1-bedroom studio'],
    [p4,'B101','Block B',1,2,2,75,180000,'occupied','Corner 2-bedroom'],
    [p5,'B102','Block B',1,3,2,100,250000,'occupied','Premium 3-bedroom'],
    [p6,'B201','Block B',2,2,1,65,155000,'vacant',  '2-bedroom flat'],
    [p7,'C101','Block C',1,4,3,130,350000,'maintenance','Penthouse 4-bedroom'],
    [p8,'C201','Block C',2,2,2,80,190000,'vacant',  'Corner 2-bedroom unit'],
  ];
  for (const p of props) {
    await run(
      'INSERT INTO properties (id,unit_number,block,floor,bedrooms,bathrooms,size_sqft,rent_amount,status,description) VALUES (?,?,?,?,?,?,?,?,?,?)',
      p
    );
  }

  // ── Leases ─────────────────────────────────────────────
  const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const leases = [
    [t1Id, p1, '2024-01-01', nextYear, 150000, 300000],
    [t2Id, p2, '2024-03-01', nextYear, 220000, 440000],
    [t3Id, p4, '2023-12-01', nextYear, 180000, 360000],
    [t4Id, p5, '2024-06-01', nextYear, 250000, 500000],
  ];
  for (const l of leases) {
    await run(
      'INSERT INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,deposit) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), ...l]
    );
  }

  // ── Bills ──────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const bills = [
    [t1Id, p1, 'Monthly Rent — June', 'June rent',       150000, today,         'paid',    'rent'],
    [t1Id, p1, 'Monthly Rent — July', 'July rent',       150000, '2025-07-01',  'pending', 'rent'],
    [t2Id, p2, 'Monthly Rent — June', 'June rent',       220000, today,         'paid',    'rent'],
    [t2Id, p2, 'Electricity Bill',    'May electricity',  12500, today,         'overdue', 'utility'],
    [t2Id, p2, 'Monthly Rent — July', 'July rent',       220000, '2025-07-01',  'pending', 'rent'],
    [t3Id, p4, 'Monthly Rent — June', 'June rent',       180000, today,         'pending', 'rent'],
    [t4Id, p5, 'Monthly Rent — June', 'June rent',       250000, today,         'paid',    'rent'],
    [t4Id, p5, 'Maintenance Fee',     'Gate maintenance',  8000, today,         'pending', 'maintenance'],
  ];
  for (const b of bills) {
    await run(
      'INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,status,category,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), ...b, adminId]
    );
  }
  await run("UPDATE bills SET paid_at=datetime('now','-5 days'), payment_method='bank_transfer' WHERE status='paid'");

  // ── Complaints ─────────────────────────────────────────
  const c1 = uuidv4(), c2 = uuidv4();
  await run(
    'INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status) VALUES (?,?,?,?,?,?,?,?)',
    [c1, t1Id, p1, 'Leaking pipe in bathroom', 'Pipe leaking for 2 days.', 'plumbing', 'high', 'open']
  );
  await run(
    'INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status,assigned_to) VALUES (?,?,?,?,?,?,?,?,?)',
    [c2, t2Id, p2, 'Power fluctuation', 'Lights flickering.', 'electrical', 'urgent', 'in_progress', maintId]
  );
  await run(
    'INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status) VALUES (?,?,?,?,?,?,?,?)',
    [uuidv4(), t3Id, p4, 'Gate remote not working', 'Remote stopped after rain.', 'security', 'medium', 'open']
  );
  await run(
    'INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status) VALUES (?,?,?,?,?,?,?,?)',
    [uuidv4(), t4Id, p5, 'Noise complaint', 'Neighbors loud after midnight.', 'general', 'medium', 'resolved']
  );

  // ── Messages ───────────────────────────────────────────
  await run('INSERT INTO messages (id,sender_id,complaint_id,content) VALUES (?,?,?,?)',
    [uuidv4(), t2Id, c2, 'When will this be fixed? It is urgent!']);
  await run('INSERT INTO messages (id,sender_id,complaint_id,content) VALUES (?,?,?,?)',
    [uuidv4(), maintId, c2, 'Sending an electrician tomorrow morning.']);

  // ── Access Cards ───────────────────────────────────────
  const cards = [
    [t1Id, 'NFC-001-CHI', 'nfc'],
    [t1Id, 'PHY-101-001', 'physical'],
    [t2Id, 'NFC-002-NGO', 'nfc'],
    [t3Id, 'NFC-003-BEL', 'nfc'],
    [t4Id, 'PHY-105-004', 'physical'],
  ];
  for (const c of cards) {
    await run('INSERT INTO access_cards (id,tenant_id,card_number,type) VALUES (?,?,?,?)', [uuidv4(), ...c]);
  }

  // ── Visitor Code ───────────────────────────────────────
  await run(
    'INSERT INTO visitor_codes (id,tenant_id,code,visitor_name,valid_from,valid_until,max_uses) VALUES (?,?,?,?,datetime("now"),datetime("now","+2 days"),3)',
    [uuidv4(), t1Id, 'VIS001', 'John Visitor']
  );

  // ── Notifications ──────────────────────────────────────
  const notifs = [
    [t1Id,    'Welcome!',         'Welcome to EstateManager. Your account is ready.', 'success'],
    [t1Id,    'Rent Due',         'Your July rent of ₦150,000 is due on July 1.',     'payment'],
    [t2Id,    'Overdue Bill',     'Your electricity bill of ₦12,500 is overdue.',     'error'],
    [adminId, 'New Complaint',    'Urgent: Power fluctuation in A102.',               'error'],
  ];
  for (const n of notifs) {
    await run('INSERT INTO notifications (id,user_id,title,message,type) VALUES (?,?,?,?,?)', [uuidv4(), ...n]);
  }

  // ── Activity Logs ──────────────────────────────────────
  const acts = [
    [adminId, 'login',         'user', adminId, 'Admin logged in',              'success'],
    [t1Id,    'login',         'user', t1Id,    'Tenant Chidi logged in',       'success'],
    [adminId, 'create_tenant', 'user', t2Id,    'Tenant Ngozi onboarded',       'new_entry'],
    [t2Id,    'pay_bill',      'bill', null,    'Bill paid via bank_transfer',  'success'],
  ];
  for (const a of acts) {
    await run(
      'INSERT INTO activity_logs (id,user_id,action,entity_type,entity_id,details,status) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), ...a]
    );
  }

  // ── Announcements ──────────────────────────────────────
  await run(
    'INSERT INTO announcements (id,title,content,type,target_audience,created_by) VALUES (?,?,?,?,?,?)',
    [uuidv4(), 'Water Outage Notice',
      'Scheduled water outage Saturday July 6 from 8AM–12PM. Please store water.',
      'maintenance', 'all', adminId]
  );
  await run(
    'INSERT INTO announcements (id,title,content,type,target_audience,created_by) VALUES (?,?,?,?,?,?)',
    [uuidv4(), 'Estate AGM',
      'Annual General Meeting — July 20, 2025 at 3PM in the community hall. Attendance mandatory.',
      'event', 'all', adminId]
  );

  console.log('\n✅ Database seeded successfully!\n');
  console.log('═══════════════════════════════════════════════');
  console.log('  Admin:       admin@estatemanager.com / admin123');
  console.log('  Tenant:      chidi@email.com         / tenant123');
  console.log('  Maintenance: maintenance@estatemanager.com / tenant123');
  console.log('═══════════════════════════════════════════════\n');
  process.exit(0);
}

// Wait for DB tables to be created before seeding
setTimeout(() => {
  seed().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  });
}, 1500);
