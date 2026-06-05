'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');
const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  if (!process.env.SMTP_USER) return console.log('Email skipped — no SMTP configured');
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await t.sendMail({ from: process.env.EMAIL_FROM || 'EstateManager <noreply@estate.com>', to, subject, html });
    console.log('📧 Email sent to', to);
  } catch(e) { console.log('Email error:', e.message); }
};

// GET /api/kyc/properties — vacant properties for onboarding (public)
const getVacantProperties = (req, res) => {
  // Use only columns guaranteed to exist in old + new DBs
  db.all(`SELECT id, unit_number, block, floor, bedrooms, bathrooms,
      size_sqft, rent_amount, description, status
    FROM properties WHERE status='vacant' ORDER BY unit_number`,
    [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// POST /api/kyc/apply
const submitKYC = (req, res) => {
  const tenantId = req.user.id;
  const {
    property_id, tenant_type = 'individual',
    full_name, date_of_birth, gender, nationality, marital_status,
    occupation, employer, residential_address,
    nok_name, nok_relationship, nok_phone, nok_email, nok_address,
    guarantor_name, guarantor_phone, guarantor_address, guarantor_id_type, guarantor_employment,
    emergency_name, emergency_phone, emergency_relationship,
    vehicle_plate, vehicle_reg, num_occupants, pet_info,
    company_name, company_tin, company_reg, authorized_signatory
  } = req.body;

  if (!property_id) return res.status(400).json({ error: 'Please select a property' });
  if (!full_name || !date_of_birth || !gender) return res.status(400).json({ error: 'Full name, date of birth and gender are required' });
  if (!nok_name || !nok_phone) return res.status(400).json({ error: 'Next of kin name and phone are required' });
  if (!emergency_name || !emergency_phone) return res.status(400).json({ error: 'Emergency contact is required' });

  db.get("SELECT id, unit_number, rent_amount FROM properties WHERE id=? AND status='vacant'", [property_id], (err, prop) => {
    if (!prop) return res.status(400).json({ error: 'Selected property is no longer available' });

    db.get("SELECT id FROM kyc_applications WHERE tenant_id=? AND status IN ('pending','under_review','approved')", [tenantId], (err2, existing) => {
      if (existing) return res.status(409).json({ error: 'You already have an active application. Please wait for a decision.' });

      const files = req.files || {};
      const getFile = (field) => files[field]?.[0] ? `/uploads/${files[field][0].filename}` : null;
      const getFiles = (field) => files[field]?.length ? JSON.stringify(files[field].map(f => `/uploads/${f.filename}`)) : null;

      const id = uuidv4();
      db.run(`INSERT INTO kyc_applications (
        id, tenant_id, property_id, tenant_type,
        full_name, date_of_birth, gender, nationality, marital_status,
        occupation, employer, residential_address,
        nok_name, nok_relationship, nok_phone, nok_email, nok_address,
        guarantor_name, guarantor_phone, guarantor_address, guarantor_id_type, guarantor_employment,
        emergency_name, emergency_phone, emergency_relationship,
        vehicle_plate, vehicle_reg, num_occupants, pet_info,
        company_name, company_tin, company_reg, authorized_signatory,
        id_document, proof_of_address, passport_photo, employment_docs, guarantor_docs,
        status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
        [id, tenantId, property_id, tenant_type,
          full_name, date_of_birth, gender, nationality||null, marital_status||null,
          occupation||null, employer||null, residential_address||null,
          nok_name, nok_relationship, nok_phone, nok_email||null, nok_address||null,
          guarantor_name||null, guarantor_phone||null, guarantor_address||null, guarantor_id_type||null, guarantor_employment||null,
          emergency_name, emergency_phone, emergency_relationship,
          vehicle_plate||null, vehicle_reg||null, num_occupants||1, pet_info||null,
          company_name||null, company_tin||null, company_reg||null, authorized_signatory||null,
          getFile('id_document'), getFile('proof_of_address'), getFile('passport_photo'),
          getFiles('employment_docs'), getFiles('guarantor_docs')],
        function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          db.run("UPDATE users SET onboarding_status='kyc_submitted', updated_at=datetime('now') WHERE id=?", [tenantId]);
          db.all("SELECT id FROM users WHERE role='admin'", [], (e, admins) => {
            (admins||[]).forEach(a => createNotification(a.id, '📋 New KYC Application', `${full_name} applied for Unit ${prop.unit_number}`, 'kyc'));
          });
          logActivity(tenantId, 'kyc_submitted', 'kyc', id, `KYC submitted for Unit ${prop.unit_number}`, req.ip, 'new_entry');
          res.status(201).json({ id, message: 'KYC application submitted successfully! We will review and contact you within 1-3 business days.' });
        }
      );
    });
  });
};

// GET /api/kyc/my-application
const getMyApplication = (req, res) => {
  db.get(`SELECT k.*, p.unit_number, p.block, p.rent_amount, p.bedrooms, p.bathrooms
    FROM kyc_applications k JOIN properties p ON p.id=k.property_id
    WHERE k.tenant_id=? ORDER BY k.created_at DESC LIMIT 1`,
    [req.user.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || null);
    }
  );
};

// GET /api/kyc — admin list
const getAllApplications = (req, res) => {
  const { status='' } = req.query;
  let where = 'WHERE 1=1'; const params = [];
  if (status) { where += ' AND k.status=?'; params.push(status); }
  db.all(`SELECT k.id, k.tenant_id, k.status, k.tenant_type, k.full_name,
      k.submitted_at, k.reviewed_at, u.email, u.phone, p.unit_number, p.rent_amount
    FROM kyc_applications k
    JOIN users u ON u.id=k.tenant_id
    JOIN properties p ON p.id=k.property_id
    ${where} ORDER BY k.submitted_at DESC`, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// GET /api/kyc/:id — full application
const getApplication = (req, res) => {
  db.get(`SELECT k.*, u.email, u.phone, u.name as user_name,
      p.unit_number, p.block, p.floor, p.rent_amount, p.bedrooms, p.bathrooms
    FROM kyc_applications k
    JOIN users u ON u.id=k.tenant_id
    JOIN properties p ON p.id=k.property_id
    WHERE k.id=?`, [req.params.id], (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'Application not found' });
      res.json(row);
    }
  );
};

// PUT /api/kyc/:id/review — admin approve/reject
const reviewApplication = async (req, res) => {
  const { action, admin_notes } = req.body;
  if (!['approve','reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

  db.get(`SELECT k.*, p.unit_number, p.rent_amount, u.email, u.name
    FROM kyc_applications k
    JOIN properties p ON p.id=k.property_id
    JOIN users u ON u.id=k.tenant_id
    WHERE k.id=?`, [req.params.id], async (err, app) => {
      if (!app) return res.status(404).json({ error: 'Application not found' });

      const newStatus = action==='approve' ? 'approved' : 'rejected';
      const onboardingStatus = action==='approve' ? 'kyc_approved' : 'kyc_rejected';

      db.run(`UPDATE kyc_applications SET status=?, admin_notes=?, reviewed_by=?,
        reviewed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        [newStatus, admin_notes||null, req.user.id, req.params.id], async (e) => {
          if (e) return res.status(500).json({ error: e.message });
          db.run("UPDATE users SET onboarding_status=? WHERE id=?", [onboardingStatus, app.tenant_id]);

          if (action==='approve') {
            // Create deposit + first rent bills
            db.run('INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,category,created_by) VALUES (?,?,?,?,?,?,date("now"),"deposit",?)',
              [uuidv4(), app.tenant_id, app.property_id, 'Security Deposit', 'Refundable security deposit', app.rent_amount*2, req.user.id]);
            db.run('INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,category,created_by) VALUES (?,?,?,?,?,?,date("now"),"rent",?)',
              [uuidv4(), app.tenant_id, app.property_id, 'First Month Rent', 'Payment to activate your tenancy', app.rent_amount, req.user.id]);

            createNotification(app.tenant_id, '🎉 KYC Approved!',
              `Your application for Unit ${app.unit_number} is approved! Please pay your deposit and first rent to move in.`, 'kyc');

            await sendEmail(app.email, 'Your EstateManager Application is Approved! 🏠', `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#00361a;padding:24px 30px;border-radius:12px 12px 0 0">
                  <h1 style="color:white;margin:0;font-size:24px">🏠 EstateManager</h1>
                </div>
                <div style="padding:30px;background:#f9fafb;border-radius:0 0 12px 12px">
                  <h2 style="color:#00361a">Congratulations, ${app.name}! 🎉</h2>
                  <p>Your tenancy application for <strong>Unit ${app.unit_number}</strong> has been <strong style="color:#00361a">APPROVED</strong>.</p>
                  <div style="background:white;border-radius:10px;padding:20px;margin:20px 0;border-left:4px solid #00361a">
                    <p style="margin:0"><strong>Unit:</strong> ${app.unit_number}</p>
                    <p style="margin:8px 0"><strong>Monthly Rent:</strong> ₦${Number(app.rent_amount).toLocaleString()}</p>
                    <p style="margin:0"><strong>What's next?</strong> Log in and pay your deposit + first month rent to activate your unit.</p>
                  </div>
                  ${admin_notes ? `<p><strong>Note from management:</strong> ${admin_notes}</p>` : ''}
                  <a href="${process.env.CLIENT_URL||'http://localhost:3000'}/tenant/pending.html"
                    style="display:inline-block;background:#00361a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
                    Complete Payment →
                  </a>
                </div>
              </div>`);
          } else {
            createNotification(app.tenant_id, 'Application Update',
              `Your application requires attention. ${admin_notes||'Please resubmit with correct documents.'}`, 'warning');
            await sendEmail(app.email, 'EstateManager — Application Update', `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px">
                <h2 style="color:#00361a">Application Status Update</h2>
                <p>Dear ${app.name}, your application for Unit ${app.unit_number} needs attention.</p>
                ${admin_notes ? `<p><strong>Reason:</strong> ${admin_notes}</p>` : ''}
                <p>Please log in to review and resubmit your application.</p>
                <a href="${process.env.CLIENT_URL||'http://localhost:3000'}" style="background:#00361a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Log In</a>
              </div>`);
          }

          logActivity(req.user.id, `kyc_${action}`, 'kyc', req.params.id, `KYC ${action}d for ${app.name}`, req.ip);
          res.json({ message: `Application ${action}d` });
        }
      );
    }
  );
};

// POST /api/kyc/:id/activate
const activateTenant = (req, res) => {
  db.get(`SELECT k.*, p.unit_number, p.rent_amount
    FROM kyc_applications k JOIN properties p ON p.id=k.property_id
    WHERE k.id=? AND k.status='approved'`, [req.params.id], (err, app) => {
      if (!app) return res.status(404).json({ error: 'Approved application not found' });
      const endDate = req.body.lease_end_date || new Date(Date.now()+365*24*60*60*1000).toISOString().split('T')[0];
      const leaseId = uuidv4();
      db.run('INSERT OR IGNORE INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,deposit) VALUES (?,?,?,date("now"),?,?,?)',
        [leaseId, app.tenant_id, app.property_id, endDate, app.rent_amount, app.rent_amount*2], (e) => {
          if (e) return res.status(500).json({ error: e.message });
          db.run("UPDATE properties SET status='occupied' WHERE id=?", [app.property_id]);
          db.run("UPDATE users SET onboarding_status='active' WHERE id=?", [app.tenant_id]);
          createNotification(app.tenant_id, '🔑 Welcome Home!', `Unit ${app.unit_number} is now yours! All services are active.`, 'success');
          res.json({ message: 'Tenant activated', lease_id: leaseId });
        }
      );
    }
  );
};

module.exports = { getVacantProperties, submitKYC, getMyApplication, getAllApplications, getApplication, reviewApplication, activateTenant };
