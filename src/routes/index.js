// src/routes/index.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../middleware/auth');

const authCtrl = require('../controllers/authController');
const tenantsCtrl = require('../controllers/tenantsController');
const propertiesCtrl = require('../controllers/propertiesController');
const billsCtrl = require('../controllers/billsController');
const complaintsCtrl = require('../controllers/complaintsController');
const accessCtrl = require('../controllers/accessController');
const dashboardCtrl = require('../controllers/dashboardController');
const notificationsCtrl = require('../controllers/notificationsController');
const leasesCtrl = require('../controllers/leasesController');
const kycCtrl = require('../controllers/kycController');
const paystackCtrl = require('../controllers/paystackController');
const nfcCtrl = require('../controllers/nfcController');

// ─── Multer ──────────────────────────────────────────────
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|gif|pdf|webp/i.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

const kycUpload = upload.fields([
  { name: 'id_document', maxCount: 1 },
  { name: 'proof_of_address', maxCount: 1 },
  { name: 'passport_photo', maxCount: 1 },
  { name: 'employment_docs', maxCount: 3 },
  { name: 'guarantor_docs', maxCount: 2 }
]);

const router = express.Router();
const admin = [authenticate, authorize('admin')];
const adminOrSupport = [authenticate, authorize('admin', 'support')];
const auth = [authenticate];

// ─── AUTH ─────────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);
router.post('/auth/register', authCtrl.register);
router.get('/auth/me', ...auth, authCtrl.getMe);
router.put('/auth/profile', ...auth, upload.single('avatar'), authCtrl.updateProfile);
router.put('/auth/change-password', ...auth, authCtrl.changePassword);

// ─── DASHBOARD ────────────────────────────────────────────
router.get('/dashboard/admin', ...admin, dashboardCtrl.getAdminDashboard);
router.get('/dashboard/tenant', ...auth, dashboardCtrl.getTenantDashboard);
router.get('/dashboard/maintenance', ...auth, authorize('maintenance', 'admin'), dashboardCtrl.getMaintenanceDashboard);

// ─── KYC / ONBOARDING ────────────────────────────────────
router.get('/kyc/properties', kycCtrl.getVacantProperties);           // public
router.post('/kyc/apply', ...auth, kycUpload, kycCtrl.submitKYC);
router.get('/kyc/my-application', ...auth, kycCtrl.getMyApplication);
router.get('/kyc', ...admin, kycCtrl.getAllApplications);
router.get('/kyc/:id', ...admin, kycCtrl.getApplication);
router.put('/kyc/:id/review', ...admin, kycCtrl.reviewApplication);
router.post('/kyc/:id/activate', ...admin, kycCtrl.activateTenant);

// ─── TENANTS ─────────────────────────────────────────────
router.get('/tenants', ...admin, tenantsCtrl.getAllTenants);
router.post('/tenants', ...admin, tenantsCtrl.createTenant);
router.get('/tenants/:id', ...admin, tenantsCtrl.getTenant);
router.put('/tenants/:id', ...admin, tenantsCtrl.updateTenant);
router.delete('/tenants/:id', ...admin, tenantsCtrl.deleteTenant);

// ─── PROPERTIES ──────────────────────────────────────────
router.get('/properties', ...auth, propertiesCtrl.getAllProperties);
router.get('/properties/stats', ...admin, propertiesCtrl.getPropertyStats);
router.post('/properties', ...admin, propertiesCtrl.createProperty);
router.get('/properties/:id', ...auth, propertiesCtrl.getProperty);
router.put('/properties/:id', ...admin, propertiesCtrl.updateProperty);
router.delete('/properties/:id', ...admin, propertiesCtrl.deleteProperty);

// ─── LEASES ──────────────────────────────────────────────
router.get('/leases', ...auth, leasesCtrl.getLeases);
router.post('/leases', ...admin, leasesCtrl.createLease);
router.get('/leases/:id', ...auth, leasesCtrl.getLease);
router.put('/leases/:id', ...admin, leasesCtrl.updateLease);

// ─── BILLS ───────────────────────────────────────────────
router.get('/bills', ...auth, billsCtrl.getBills);
router.get('/bills/summary', ...admin, billsCtrl.getBillsSummary);
router.post('/bills', ...admin, billsCtrl.createBill);
router.post('/bills/bulk', ...admin, billsCtrl.createBulkBills);
router.get('/bills/:id', ...auth, billsCtrl.getBill);
router.post('/bills/:id/pay', ...auth, billsCtrl.payBill);
router.delete('/bills/:id', ...admin, billsCtrl.cancelBill);

// ─── PAYMENTS (PAYSTACK) ─────────────────────────────────
router.post('/payments/initialize', ...auth, paystackCtrl.initializePayment);
router.get('/payments/verify/:reference', ...auth, paystackCtrl.verifyPayment);
router.post('/payments/webhook', express.raw({ type: 'application/json' }), paystackCtrl.webhook);
router.get('/payments/history', ...auth, paystackCtrl.getPaymentHistory);

// ─── COMPLAINTS ──────────────────────────────────────────
router.get('/complaints', ...auth, complaintsCtrl.getComplaints);
router.get('/complaints/stats', ...adminOrSupport, complaintsCtrl.getComplaintStats);
router.post('/complaints', ...auth, upload.array('images', 5), complaintsCtrl.createComplaint);
router.get('/complaints/:id', ...auth, complaintsCtrl.getComplaint);
router.put('/complaints/:id', ...adminOrSupport, complaintsCtrl.updateComplaint);
router.post('/complaints/:id/messages', ...auth, complaintsCtrl.sendMessage);

// ─── ACCESS CONTROL ──────────────────────────────────────
router.get('/access/cards', ...auth, accessCtrl.getAccessCards);
router.post('/access/cards', ...auth, accessCtrl.createAccessCard);
router.put('/access/cards/:id', ...admin, accessCtrl.updateAccessCard);
router.delete('/access/cards/:id', ...admin, accessCtrl.deleteAccessCard);
router.get('/access/visitor-codes', ...auth, accessCtrl.getVisitorCodes);
router.post('/access/visitor-codes', ...auth, accessCtrl.createVisitorCode);
router.delete('/access/visitor-codes/:id', ...auth, accessCtrl.revokeVisitorCode);
router.post('/access/visitor-codes/:id/resend', ...auth, accessCtrl.resendVisitorCode);
router.post('/access/verify', accessCtrl.verifyAccess);
router.get('/access/logs', ...auth, accessCtrl.getAccessLogs);

// ─── NFC HARDWARE ─────────────────────────────────────────
router.get('/nfc/devices', ...admin, nfcCtrl.getDevices);
router.post('/nfc/devices', ...admin, nfcCtrl.addDevice);
router.put('/nfc/devices/:id', ...admin, nfcCtrl.updateDevice);
router.delete('/nfc/devices/:id', ...admin, nfcCtrl.deleteDevice);
router.post('/nfc/devices/:id/ping', ...admin, nfcCtrl.pingDevice);
router.post('/nfc/provision/:card_id', ...admin, nfcCtrl.provisionCard);
router.post('/nfc/revoke/:card_id', ...admin, nfcCtrl.revokeCardFromDevices);
router.post('/nfc/gate/:device_id/open', ...admin, nfcCtrl.openGate);
router.post('/nfc/heartbeat', nfcCtrl.heartbeat);   // called by hardware devices
router.post('/nfc/scan', nfcCtrl.processScan);      // called by hardware on card tap

// ─── NOTIFICATIONS ───────────────────────────────────────
router.get('/notifications', ...auth, notificationsCtrl.getNotifications);
router.put('/notifications/read-all', ...auth, notificationsCtrl.markAllRead);
router.put('/notifications/:id/read', ...auth, notificationsCtrl.markRead);
router.post('/notifications/broadcast', ...admin, notificationsCtrl.broadcastNotification);

// ─── ACTIVITY LOGS ───────────────────────────────────────
router.get('/activity-logs', ...admin, (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  const offset = (page - 1) * limit;
  require('../config/database').all(
    `SELECT al.*, u.name as user_name, u.role FROM activity_logs al
     LEFT JOIN users u ON u.id=al.user_id ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
    [parseInt(limit), offset],
    (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows); }
  );
});

// ─── ANNOUNCEMENTS ───────────────────────────────────────
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
router.get('/announcements', ...auth, (req, res) => {
  db.all("SELECT * FROM announcements WHERE is_active=1 AND (expires_at IS NULL OR expires_at>datetime('now')) ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message }); res.json(rows);
  });
});
router.post('/announcements', ...admin, (req, res) => {
  const { title, content, type, target_audience, expires_at } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const id = uuidv4();
  db.run('INSERT INTO announcements (id,title,content,type,target_audience,created_by,expires_at) VALUES (?,?,?,?,?,?,?)',
    [id, title, content, type || 'general', target_audience || 'all', req.user?.id, expires_at || null],
    err => { if (err) return res.status(500).json({ error: err.message }); res.status(201).json({ id, message: 'Announcement created' }); }
  );
});

// ─── REPORTS ─────────────────────────────────────────────
router.get('/reports/financial', ...admin, (req, res) => {
  const { from, to } = req.query;
  const f = from || new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0];
  const t = to || new Date().toISOString().split('T')[0];
  db.all(`SELECT b.*, u.name as tenant_name, p.unit_number FROM bills b
    JOIN users u ON u.id=b.tenant_id LEFT JOIN properties p ON p.id=b.property_id
    WHERE b.created_at BETWEEN ? AND ? ORDER BY b.created_at DESC`,
    [f, t + ' 23:59:59'],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const revenue = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
      const pending = rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
      res.json({ from: f, to: t, transactions: rows, total_revenue: revenue, total_pending: pending });
    }
  );
});

// ─── HEALTH ──────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' }));

module.exports = router;

// ─── DATABASE VIEWER (admin only) ────────────────────────
// Allows admin to run READ-ONLY queries via the dashboard
router.get('/db/query', ...admin, (req, res) => {
  const sql = req.query.sql || '';
  if (!sql) return res.status(400).json({ error: 'sql parameter required' });

  // Block any write operations for safety
  const upper = sql.trim().toUpperCase();
  const forbidden = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'CREATE ', 'TRUNCATE ', 'REPLACE '];
  if (forbidden.some(f => upper.startsWith(f) || upper.includes('; ' + f))) {
    return res.status(403).json({ error: 'Only SELECT queries allowed in the viewer. Use the admin dashboard to modify data.' });
  }

  require('../config/database').all(sql, [], (err, rows) => {
    if (err) return res.json({ rows: [], error: err.message });
    res.json({ rows: rows || [], count: (rows || []).length });
  });
});
