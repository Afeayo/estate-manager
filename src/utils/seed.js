// src/utils/seed.js — Fixed seed with proper FK ordering
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = require('../config/database');

const seed = async () => {
  console.log('🌱 Seeding database...');

  // Clear in FK-safe order
  await new Promise(r => db.run('DELETE FROM access_logs', r));
  await new Promise(r => db.run('DELETE FROM visitor_codes', r));
  await new Promise(r => db.run('DELETE FROM access_cards', r));
  await new Promise(r => db.run('DELETE FROM activity_logs', r));
  await new Promise(r => db.run('DELETE FROM notifications', r));
  await new Promise(r => db.run('DELETE FROM messages', r));
  await new Promise(r => db.run('DELETE FROM complaints', r));
  await new Promise(r => db.run('DELETE FROM bills', r));
  await new Promise(r => db.run('DELETE FROM leases', r));
  await new Promise(r => db.run('DELETE FROM properties', r));
  await new Promise(r => db.run('DELETE FROM announcements', r));
  await new Promise(r => db.run('DELETE FROM users', r));

  // ─── USERS ────────────────────────────────────────────
  const adminId   = uuidv4();
  const maintId   = uuidv4();
  const supportId = uuidv4();
  const t1Id = uuidv4();
  const t2Id = uuidv4();
  const t3Id = uuidv4();
  const t4Id = uuidv4();

  const adminHash  = await bcrypt.hash('admin123', 12);
  const staffHash  = await bcrypt.hash('tenant123', 12);

  const insertUser = (id, name, email, hash, role, phone) =>
    new Promise((res, rej) =>
      db.run('INSERT INTO users (id,name,email,password,role,phone) VALUES (?,?,?,?,?,?)',
        [id,name,email,hash,role,phone], err => err ? rej(err) : res()));

  await insertUser(adminId,   'Admin Manager',     'admin@estatemanager.com',     adminHash,  'admin',       '+234 801 000 0001');
  await insertUser(maintId,   'Emeka Technician',  'maintenance@estatemanager.com',staffHash, 'maintenance', '+234 801 000 0002');
  await insertUser(supportId, 'Amaka Support',     'support@estatemanager.com',   staffHash,  'support',     '+234 801 000 0003');
  await insertUser(t1Id,      'Chidi Okafor',      'chidi@email.com',             staffHash,  'tenant',      '+234 802 111 2222');
  await insertUser(t2Id,      'Ngozi Adeyemi',     'ngozi@email.com',             staffHash,  'tenant',      '+234 803 222 3333');
  await insertUser(t3Id,      'Bello Ibrahim',     'bello@email.com',             staffHash,  'tenant',      '+234 804 333 4444');
  await insertUser(t4Id,      'Funke Ojo',         'funke@email.com',             staffHash,  'tenant',      '+234 805 444 5555');

  // ─── PROPERTIES ──────────────────────────────────────
  const p1=uuidv4(),p2=uuidv4(),p3=uuidv4(),p4=uuidv4(),p5=uuidv4(),p6=uuidv4(),p7=uuidv4(),p8=uuidv4();
  const insertProp = (id,unit,block,floor,beds,baths,sqft,rent,status,desc) =>
    new Promise((res,rej) =>
      db.run('INSERT INTO properties (id,unit_number,block,floor,bedrooms,bathrooms,size_sqft,rent_amount,status,description) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id,unit,block,floor,beds,baths,sqft,rent,status,desc], err=>err?rej(err):res()));

  await insertProp(p1,'A101','Block A',1,2,1,65,150000,'occupied','Modern 2-bedroom flat');
  await insertProp(p2,'A102','Block A',1,3,2,90,220000,'occupied','Spacious 3-bedroom');
  await insertProp(p3,'A201','Block A',2,1,1,45,100000,'vacant','1-bedroom studio');
  await insertProp(p4,'B101','Block B',1,2,2,75,180000,'occupied','Corner 2-bedroom');
  await insertProp(p5,'B102','Block B',1,3,2,100,250000,'occupied','Premium 3-bedroom');
  await insertProp(p6,'B201','Block B',2,2,1,65,155000,'vacant','2-bedroom flat');
  await insertProp(p7,'C101','Block C',1,4,3,130,350000,'maintenance','Penthouse 4-bedroom');
  await insertProp(p8,'C201','Block C',2,2,2,80,190000,'vacant','Corner 2-bedroom unit');

  // ─── LEASES ──────────────────────────────────────────
  const nextYear = new Date(Date.now()+365*24*60*60*1000).toISOString().split('T')[0];
  const insertLease = (tid,pid,start,end,rent,dep) =>
    new Promise((res,rej) =>
      db.run('INSERT INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,deposit) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(),tid,pid,start,end,rent,dep], err=>err?rej(err):res()));

  await insertLease(t1Id,p1,'2024-01-01',nextYear,150000,300000);
  await insertLease(t2Id,p2,'2024-03-01',nextYear,220000,440000);
  await insertLease(t3Id,p4,'2023-12-01',nextYear,180000,360000);
  await insertLease(t4Id,p5,'2024-06-01',nextYear,250000,500000);

  // ─── BILLS ───────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const insertBill = (tid,pid,title,desc,amount,due,status,category) =>
    new Promise((res,rej) =>
      db.run('INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,status,category,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(),tid,pid,title,desc,amount,due,status,category,adminId], err=>err?rej(err):res()));

  await insertBill(t1Id,p1,'Monthly Rent — June','June 2025 rent',150000,today,'paid','rent');
  await insertBill(t1Id,p1,'Service Charge Q2','Q2 service charge',15000,today,'paid','service');
  await insertBill(t1Id,p1,'Monthly Rent — July','July 2025 rent',150000,'2025-07-01','pending','rent');
  await insertBill(t2Id,p2,'Monthly Rent — June','June 2025 rent',220000,today,'paid','rent');
  await insertBill(t2Id,p2,'Electricity Bill','May electricity',12500,today,'overdue','utility');
  await insertBill(t2Id,p2,'Monthly Rent — July','July 2025 rent',220000,'2025-07-01','pending','rent');
  await insertBill(t3Id,p4,'Monthly Rent — June','June 2025 rent',180000,today,'pending','rent');
  await insertBill(t3Id,p4,'Water Bill May','May water supply',5000,'2025-05-31','overdue','utility');
  await insertBill(t4Id,p5,'Monthly Rent — June','June 2025 rent',250000,today,'paid','rent');
  await insertBill(t4Id,p5,'Maintenance Fee','Gate system maintenance',8000,today,'pending','maintenance');

  await new Promise(r => db.run("UPDATE bills SET paid_at=datetime('now','-5 days'),payment_method='bank_transfer' WHERE status='paid'", r));

  // ─── COMPLAINTS ──────────────────────────────────────
  const insertComp = (tid,pid,title,desc,cat,pri,status) =>
    new Promise((res,rej) =>
      db.run('INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status) VALUES (?,?,?,?,?,?,?,?)',
        [uuidv4(),tid,pid,title,desc,cat,pri,status], err=>err?rej(err):res()));

  const c1id=uuidv4(), c2id=uuidv4();
  await new Promise((res,rej)=>db.run('INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status) VALUES (?,?,?,?,?,?,?,?)',
    [c1id,t1Id,p1,'Leaking pipe in bathroom','Bathroom pipe leaking for 2 days. Water pooling on floor.','plumbing','high','open'],err=>err?rej(err):res()));
  await new Promise((res,rej)=>db.run('INSERT INTO complaints (id,tenant_id,property_id,title,description,category,priority,status,assigned_to) VALUES (?,?,?,?,?,?,?,?,?)',
    [c2id,t2Id,p2,'Power fluctuation','Lights flickering, appliances getting damaged.','electrical','urgent','in_progress',maintId],err=>err?rej(err):res()));
  await insertComp(t3Id,p4,'Gate remote not working','Gate remote stopped responding after the rain.','security','medium','open');
  await insertComp(t4Id,p5,'Noise complaint','Neighbors playing loud music after midnight.','general','medium','resolved');
  await insertComp(t1Id,p1,'AC not cooling','Air conditioner running but not cooling the room.','hvac','medium','open');

  // ─── MESSAGES ────────────────────────────────────────
  await new Promise((res,rej)=>db.run('INSERT INTO messages (id,sender_id,complaint_id,content) VALUES (?,?,?,?)',
    [uuidv4(),t2Id,c2id,'When will this be fixed? It is very urgent!'],err=>err?rej(err):res()));
  await new Promise((res,rej)=>db.run('INSERT INTO messages (id,sender_id,complaint_id,content) VALUES (?,?,?,?)',
    [uuidv4(),maintId,c2id,'We are aware and will send an electrician by tomorrow morning.'],err=>err?rej(err):res()));

  // ─── ACCESS CARDS ────────────────────────────────────
  const insertCard = (tid,num,type) =>
    new Promise((res,rej)=>db.run('INSERT INTO access_cards (id,tenant_id,card_number,type) VALUES (?,?,?,?)',
      [uuidv4(),tid,num,type],err=>err?rej(err):res()));

  await insertCard(t1Id,'NFC-001-CHI','nfc');
  await insertCard(t1Id,'PHY-101-001','physical');
  await insertCard(t2Id,'NFC-002-NGO','nfc');
  await insertCard(t3Id,'NFC-003-BEL','nfc');
  await insertCard(t4Id,'PHY-105-004','physical');

  // ─── VISITOR CODES ───────────────────────────────────
  await new Promise((res,rej)=>db.run(
    'INSERT INTO visitor_codes (id,tenant_id,code,visitor_name,visitor_phone,valid_from,valid_until,max_uses) VALUES (?,?,?,?,?,?,?,?)',
    [uuidv4(),t1Id,'VIS001','John Visitor','+234800000001',new Date().toISOString(),
     new Date(Date.now()+2*24*60*60*1000).toISOString(),3],err=>err?rej(err):res()));

  // ─── ACCESS LOGS ─────────────────────────────────────
  const insertLog = (pid,type,dir,status) =>
    new Promise((res,rej)=>db.run('INSERT INTO access_logs (id,person_id,access_type,direction,status) VALUES (?,?,?,?,?)',
      [uuidv4(),pid||null,type,dir,status],err=>err?rej(err):res()));

  await insertLog(t1Id,'nfc','entry','granted');
  await insertLog(t2Id,'card','entry','granted');
  await insertLog(t3Id,'nfc','exit','granted');
  await insertLog(null,'card','entry','denied');

  // ─── NOTIFICATIONS ───────────────────────────────────
  const insertNotif = (uid,title,msg,type) =>
    new Promise((res,rej)=>db.run('INSERT INTO notifications (id,user_id,title,message,type) VALUES (?,?,?,?,?)',
      [uuidv4(),uid,title,msg,type],err=>err?rej(err):res()));

  await insertNotif(t1Id,'Welcome!','Welcome to EstateManager. Your account is ready.','success');
  await insertNotif(t1Id,'Bill Due','Your July rent of ₦150,000 is due on July 1.','payment');
  await insertNotif(t2Id,'Overdue Bill','Your electricity bill of ₦12,500 is overdue.','error');
  await insertNotif(t3Id,'Pending Rent','Your June rent of ₦180,000 is pending payment.','payment');
  await insertNotif(adminId,'New Complaint','Urgent: Power fluctuation reported in A102.','error');
  await insertNotif(adminId,'New Tenant','Funke Ojo has been onboarded to Unit B102.','info');

  // ─── ACTIVITY LOGS ───────────────────────────────────
  const insertAct = (uid,action,etype,eid,details,status) =>
    new Promise((res,rej)=>db.run('INSERT INTO activity_logs (id,user_id,action,entity_type,entity_id,details,status) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(),uid,action,etype,eid,details,status],err=>err?rej(err):res()));

  await insertAct(adminId,'login','user',adminId,'Admin logged in','success');
  await insertAct(t1Id,'login','user',t1Id,'Tenant Chidi logged in','success');
  await insertAct(adminId,'create_tenant','user',t2Id,'Tenant Ngozi Adeyemi onboarded','new_entry');
  await insertAct(adminId,'create_bill','bill',null,'Bulk rent bills generated for 4 tenants','new_entry');
  await insertAct(t2Id,'pay_bill','bill',null,'Bill paid via bank_transfer — ₦220,000','success');
  await insertAct(t4Id,'pay_bill','bill',null,'Bill paid via card — ₦250,000','success');

  // ─── ANNOUNCEMENTS ───────────────────────────────────
  await new Promise((res,rej)=>db.run(
    'INSERT INTO announcements (id,title,content,type,target_audience,created_by) VALUES (?,?,?,?,?,?)',
    [uuidv4(),'Water Outage Notice','There will be a scheduled water outage on Saturday July 6, 2025 from 8AM–12PM for maintenance works. Please store water in advance.','maintenance','all',adminId],
    err=>err?rej(err):res()));
  await new Promise((res,rej)=>db.run(
    'INSERT INTO announcements (id,title,content,type,target_audience,created_by) VALUES (?,?,?,?,?,?)',
    [uuidv4(),'Estate AGM','Annual General Meeting is scheduled for July 20, 2025 at 3PM in the community hall. Attendance is mandatory for all tenants.','event','all',adminId],
    err=>err?rej(err):res()));

  console.log('\n✅ Database seeded successfully!\n');
  console.log('═══════════════════════════════════════════════');
  console.log('  🔑 LOGIN CREDENTIALS');
  console.log('═══════════════════════════════════════════════');
  console.log('  Admin:       admin@estatemanager.com / admin123');
  console.log('  Tenant 1:    chidi@email.com         / tenant123');
  console.log('  Tenant 2:    ngozi@email.com         / tenant123');
  console.log('  Tenant 3:    bello@email.com         / tenant123');
  console.log('  Tenant 4:    funke@email.com         / tenant123');
  console.log('  Maintenance: maintenance@estatemanager.com / tenant123');
  console.log('═══════════════════════════════════════════════\n');
  setTimeout(()=>process.exit(0),300);
};

setTimeout(seed, 1200);

// Mark seeded tenants as 'active' (they already have leases)
const activeTenants = [t1Id, t2Id, t3Id, t4Id];
for(const tid of activeTenants){
  await new Promise((res,rej) =>
    db.run("UPDATE users SET onboarding_status='active' WHERE id=?", [tid], err=>err?rej(err):res()));
}
console.log('✅ Tenants marked as active');
