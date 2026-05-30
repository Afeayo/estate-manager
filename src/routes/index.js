// src/routes/index.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../middleware/auth');

// ─── Controllers ───────────────────────────────────────────
const authCtrl = require('../controllers/authController');
const tenantsCtrl = require('../controllers/tenantsController');
const propertiesCtrl = require('../controllers/propertiesController');
const billsCtrl = require('../controllers/billsController');
const complaintsCtrl = require('../controllers/complaintsController');
const accessCtrl = require('../controllers/accessController');
const dashboardCtrl = require('../controllers/dashboardController');
const notificationsCtrl = require('../controllers/notificationsController');
const leasesCtrl = require('../controllers/leasesController');

// ─── Multer Setup ──────────────────────────────────────────
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
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

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

router.post('/access/verify', accessCtrl.verifyAccess); // gate system — no auth
router.get('/access/logs', ...auth, accessCtrl.getAccessLogs);

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
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
    [parseInt(limit), offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ─── ANNOUNCEMENTS ───────────────────────────────────────
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
router.get('/announcements', ...auth, (req, res) => {
  db.all("SELECT * FROM announcements WHERE is_active=1 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
router.post('/announcements', ...admin, (req, res) => {
  const { title, content, type, target_audience, expires_at } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const id = uuidv4();
  db.run('INSERT INTO announcements (id, title, content, type, target_audience, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, content, type || 'general', target_audience || 'all', req.user.id, expires_at || null],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id, message: 'Announcement created' });
    }
  );
});

// ─── REPORTS ────────────────────────────────────────────
router.get('/reports/financial', ...admin, (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const toDate = to || new Date().toISOString().split('T')[0];

  db.all(
    `SELECT b.id, b.title, b.category, b.amount, b.status, b.paid_at, b.payment_method,
      u.name as tenant_name, p.unit_number
     FROM bills b
     JOIN users u ON u.id = b.tenant_id
     LEFT JOIN properties p ON p.id = b.property_id
     WHERE b.created_at BETWEEN ? AND ?
     ORDER BY b.created_at DESC`,
    [fromDate, toDate + ' 23:59:59'],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const revenue = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
      const pending = rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
      res.json({ from: fromDate, to: toDate, transactions: rows, total_revenue: revenue, total_pending: pending });
    }
  );
});

module.exports = router;
