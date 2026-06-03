// src/controllers/kycController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');
const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  if (!process.env.SMTP_USER) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({ from: process.env.EMAIL_FROM || 'EstateManager <noreply@estate.com>', to, subject, html }).catch(e => console.log('Email skipped:', e.message));
};

// GET /api/kyc/properties — public: list vacant properties for onboarding
const getVacantProperties = (req, res) => {
  db.all(`SELECT id, unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, description, amenities, images
    FROM properties WHERE status='vacant' ORDER BY unit_number`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
};

// POST /api/kyc/apply — tenant submits KYC
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

  if (!property_id) return res.status(400).json({ error: 'Property selection required' });
  if (!full_name || !date_of_birth || !gender) return res.status(400).json({ error: 'Personal information required' });

  // Check property still vacant
  db.get("SELECT id, unit_number, rent_amount FROM properties WHERE id=? AND status='vacant'", [property_id], (err, prop) => {
    if (!prop) return res.status(400).json({ error: 'Property not available' });

    // Check no pending application for this tenant
    db.get("SELECT id FROM kyc_applications WHERE tenant_id=? AND status IN ('pending','under_review','approved')", [tenantId], (err2, existing) => {
      if (existing) return res.status(409).json({ error: 'You already have an active application' });

      // Build file paths from uploaded files
      const files = req.files || {};
      const getFile = (field) => files[field] ? `/uploads/${files[field][0].filename}` : null;
      const getFiles = (field) => files[field] ? JSON.stringify(files[field].map(f => `/uploads/${f.filename}`)) : null;

      const id = uuidv4();
      db.run(`INSERT INTO kyc_applications (
        id, tenant_id, property_id, tenant_type,
        full_name, date_of_birth, gender, nationality, marital_status, occupation, employer, residential_address,
        nok_name, nok_relationship, nok_phone, nok_email, nok_address,
        guarantor_name, guarantor_phone, guarantor_address, guarantor_id_type, guarantor_employment,
        emergency_name, emergency_phone, emergency_relationship,
        vehicle_plate, vehicle_reg, num_occupants, pet_info,
        company_name, company_tin, company_reg, authorized_signatory,
        id_document, proof_of_address, passport_photo, employment_docs, guarantor_docs,
        status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
        [id, tenantId, property_id, tenant_type,
         full_name, date_of_birth, gender, nationality, marital_status, occupation, employer, residential_address,
         nok_name, nok_relationship, nok_phone, nok_email, nok_address,
         guarantor_name, guarantor_phone, guarantor_address, guarantor_id_type, guarantor_employment,
         emergency_name, emergency_phone, emergency_relationship,
         vehicle_plate, vehicle_reg, num_occupants || 1, pet_info,
         company_name, company_tin, company_reg, authorized_signatory,
         getFile('id_document'), getFile('proof_of_address'), getFile('passport_photo'),
         getFiles('employment_docs'), getFiles('guarantor_docs')],
        function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });

          // Update user onboarding status
          db.run("UPDATE users SET onboarding_status='kyc_submitted', updated_at=datetime('now') WHERE id=?", [tenantId]);

          // Notify admins
          db.all("SELECT id FROM users WHERE role='admin'", [], (e, admins) => {
            (admins || []).forEach(a => createNotification(a.id, 'New KYC Application', `${full_name} submitted KYC for Unit ${prop.unit_number}`, 'kyc'));
          });

          logActivity(tenantId, 'kyc_submitted', 'kyc', id, `KYC application for Unit ${prop.unit_number}`, req.ip, 'new_entry');
          res.status(201).json({ id, message: 'KYC application submitted successfully' });
        }
      );
    });
  });
};

// GET /api/kyc/my-application — tenant checks own status
const getMyApplication = (req, res) => {
  db.get(`SELECT k.*, p.unit_number, p.block, p.rent_amount, p.bedrooms
    FROM kyc_applications k JOIN properties p ON p.id=k.property_id
    WHERE k.tenant_id=? ORDER BY k.created_at DESC LIMIT 1`, [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
};

// GET /api/kyc — admin: list all applications
const getAllApplications = (req, res) => {
  const { status = '' } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND k.status=?'; params.push(status); }

  db.all(`SELECT k.id, k.tenant_id, k.status, k.tenant_type, k.full_name, k.submitted_at, k.reviewed_at,
      u.email, u.phone,
      p.unit_number, p.block, p.rent_amount
    FROM kyc_applications k
    JOIN users u ON u.id=k.tenant_id
    JOIN properties p ON p.id=k.property_id
    ${where} ORDER BY k.submitted_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
};

// GET /api/kyc/:id — admin: full application detail
const getApplication = (req, res) => {
  db.get(`SELECT k.*, u.email, u.phone, u.name as user_name,
      p.unit_number, p.block, p.floor, p.rent_amount, p.bedrooms, p.bathrooms
    FROM kyc_applications k
    JOIN users u ON u.id=k.tenant_id
    JOIN properties p ON p.id=k.property_id
    WHERE k.id=?`, [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Application not found' });
    res.json(row);
  });
};

// PUT /api/kyc/:id/review — admin approve/reject
const reviewApplication = async (req, res) => {
  const { action, admin_notes, lease_end_date } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

  db.get(`SELECT k.*, p.unit_number, p.rent_amount, u.email, u.name
    FROM kyc_applications k
    JOIN properties p ON p.id=k.property_id
    JOIN users u ON u.id=k.tenant_id
    WHERE k.id=?`, [req.params.id], async (err, app) => {
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const onboardingStatus = action === 'approve' ? 'kyc_approved' : 'kyc_rejected';

    db.run(`UPDATE kyc_applications SET status=?, admin_notes=?, reviewed_by=?, reviewed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [newStatus, admin_notes, req.user.id, req.params.id], async (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });

        db.run("UPDATE users SET onboarding_status=? WHERE id=?", [onboardingStatus, app.tenant_id]);

        if (action === 'approve') {
          // Create deposit + first month bill
          const depositId = uuidv4(), rentId = uuidv4();
          const dueDate = new Date().toISOString().split('T')[0];
          const today = new Date().toISOString().split('T')[0];
          db.run('INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,category,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
            [depositId, app.tenant_id, app.property_id, 'Security Deposit', 'Refundable security deposit', app.rent_amount * 2, dueDate, 'deposit', req.user.id]);
          db.run('INSERT INTO bills (id,tenant_id,property_id,title,description,amount,due_date,category,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
            [rentId, app.tenant_id, app.property_id, 'First Month Rent', 'Rent payment to activate your tenancy', app.rent_amount, dueDate, 'rent', req.user.id]);

          createNotification(app.tenant_id, '🎉 KYC Approved!', `Your application for Unit ${app.unit_number} has been approved. Please complete your deposit and first month payment to move in.`, 'kyc');

          await sendEmail(app.email, 'Welcome to EstateManager — Your Application is Approved!', `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#00361a;padding:30px;text-align:center">
                <h1 style="color:white;margin:0">🏠 EstateManager</h1>
              </div>
              <div style="padding:30px;background:#f9f9f9">
                <h2 style="color:#00361a">Welcome, ${app.name}!</h2>
                <p>We are pleased to inform you that your tenancy application for <strong>Unit ${app.unit_number}</strong> has been <strong style="color:#00361a">APPROVED</strong>.</p>
                <div style="background:white;border-radius:12px;padding:20px;margin:20px 0;border-left:4px solid #00361a">
                  <p><strong>Unit:</strong> ${app.unit_number} (${app.block || ''})</p>
                  <p><strong>Monthly Rent:</strong> ₦${Number(app.rent_amount).toLocaleString()}</p>
                  <p><strong>Next Steps:</strong></p>
                  <ol>
                    <li>Log in to your tenant portal</li>
                    <li>Pay your security deposit (₦${Number(app.rent_amount * 2).toLocaleString()})</li>
                    <li>Pay first month's rent (₦${Number(app.rent_amount).toLocaleString()})</li>
                    <li>Access all estate services!</li>
                  </ol>
                </div>
                ${admin_notes ? `<p style="color:#555"><strong>Note from management:</strong> ${admin_notes}</p>` : ''}
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" style="display:inline-block;background:#00361a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Go to Portal →</a>
              </div>
            </div>`);
        } else {
          createNotification(app.tenant_id, 'KYC Application Update', `Your application for Unit ${app.unit_number} requires attention. ${admin_notes || 'Please resubmit with corrected documents.'}`, 'kyc');
          await sendEmail(app.email, 'EstateManager — Application Status Update', `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px">
              <h2 style="color:#00361a">Application Status Update</h2>
              <p>Dear ${app.name}, your application for Unit ${app.unit_number} has been reviewed.</p>
              ${admin_notes ? `<p><strong>Reason:</strong> ${admin_notes}</p>` : ''}
              <p>Please log in to resubmit your application with the required corrections.</p>
            </div>`);
        }

        logActivity(req.user.id, `kyc_${action}`, 'kyc', req.params.id, `KYC ${action}d for ${app.name}`, req.ip, 'success');
        res.json({ message: `Application ${action}d successfully` });
      }
    );
  });
};

// POST /api/kyc/:id/activate — admin activates tenant after payment confirmed
const activateTenant = (req, res) => {
  const { lease_end_date } = req.body;

  db.get(`SELECT k.*, p.unit_number, p.rent_amount
    FROM kyc_applications k JOIN properties p ON p.id=k.property_id
    WHERE k.id=? AND k.status='approved'`, [req.params.id], (err, app) => {
    if (!app) return res.status(404).json({ error: 'Approved application not found' });

    const today = new Date().toISOString().split('T')[0];
    const endDate = lease_end_date || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0];
    const leaseId = uuidv4();

    // Create lease
    db.run('INSERT INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,deposit) VALUES (?,?,?,?,?,?,?)',
      [leaseId, app.tenant_id, app.property_id, today, endDate, app.rent_amount, app.rent_amount * 2], (e) => {
        if (e) return res.status(500).json({ error: e.message });

        // Mark property occupied
        db.run("UPDATE properties SET status='occupied', updated_at=datetime('now') WHERE id=?", [app.property_id]);
        // Mark user active
        db.run("UPDATE users SET onboarding_status='active', is_active=1, updated_at=datetime('now') WHERE id=?", [app.tenant_id]);

        createNotification(app.tenant_id, '🔑 Unit Assigned!', `Unit ${app.unit_number} is now yours! Welcome to the estate. All services are now active.`, 'success');
        logActivity(req.user.id, 'tenant_activated', 'lease', leaseId, `Unit ${app.unit_number} assigned to tenant`, req.ip, 'new_entry');
        res.json({ message: 'Tenant activated successfully', lease_id: leaseId });
      }
    );
  });
};

module.exports = { getVacantProperties, submitKYC, getMyApplication, getAllApplications, getApplication, reviewApplication, activateTenant };
