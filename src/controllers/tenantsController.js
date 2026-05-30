// src/controllers/tenantsController.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification, paginate } = require('../utils/helpers');

// GET /api/tenants — admin
const getAllTenants = (req, res) => {
  const { page = 1, limit = 20, search = '', status } = req.query;
  const offset = (page - 1) * limit;

  let where = "WHERE u.role = 'tenant'";
  const params = [];

  if (search) {
    where += ' AND (u.name LIKE ? OR u.email LIKE ? OR p.unit_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status === 'active') where += ' AND l.status = "active"';
  if (status === 'inactive') where += ' AND l.id IS NULL';

  const query = `
    SELECT u.id, u.name, u.email, u.phone, u.avatar, u.is_active, u.created_at,
      p.unit_number, p.block, l.id as lease_id, l.start_date, l.end_date, l.status as lease_status, l.monthly_rent,
      (SELECT COUNT(*) FROM bills b WHERE b.tenant_id = u.id AND b.status = 'pending') as pending_bills,
      (SELECT COUNT(*) FROM complaints c WHERE c.tenant_id = u.id AND c.status != 'closed') as open_complaints
    FROM users u
    LEFT JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
    LEFT JOIN properties p ON p.id = l.property_id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.all(query, [...params, parseInt(limit), offset], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get(`SELECT COUNT(*) as total FROM users u LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active' LEFT JOIN properties p ON p.id=l.property_id ${where}`, params, (err2, countRow) => {
      res.json({ tenants: rows, total: countRow?.total || 0, page: parseInt(page), limit: parseInt(limit) });
    });
  });
};

// GET /api/tenants/:id
const getTenant = (req, res) => {
  db.get(
    `SELECT u.id, u.name, u.email, u.phone, u.avatar, u.is_active, u.last_login, u.created_at,
      p.id as property_id, p.unit_number, p.block, p.floor, p.bedrooms, p.rent_amount,
      l.id as lease_id, l.start_date, l.end_date, l.monthly_rent, l.deposit, l.status as lease_status
     FROM users u
     LEFT JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
     LEFT JOIN properties p ON p.id = l.property_id
     WHERE u.id = ? AND u.role = 'tenant'`,
    [req.params.id],
    (err, tenant) => {
      if (err || !tenant) return res.status(404).json({ error: 'Tenant not found' });

      // Get bills summary
      db.all('SELECT status, SUM(amount) as total, COUNT(*) as count FROM bills WHERE tenant_id = ? GROUP BY status', [tenant.id], (e, bills) => {
        // Get recent activity
        db.all('SELECT action, details, status, created_at FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [tenant.id], (e2, activity) => {
          res.json({ ...tenant, bills_summary: bills, recent_activity: activity });
        });
      });
    }
  );
};

// POST /api/tenants — admin registers new tenant
const createTenant = async (req, res) => {
  const { name, email, password, phone, unit_number, start_date, end_date, deposit } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

  const hash = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  db.run(
    'INSERT INTO users (id, name, email, password, role, phone) VALUES (?, ?, ?, ?, "tenant", ?)',
    [userId, name, email, hash, phone || null],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
        return res.status(500).json({ error: 'Failed to create tenant' });
      }

      if (unit_number) {
        db.get('SELECT id, rent_amount FROM properties WHERE unit_number = ?', [unit_number], (err2, prop) => {
          if (prop) {
            const leaseId = uuidv4();
            db.run(
              'INSERT INTO leases (id, tenant_id, property_id, start_date, end_date, monthly_rent, deposit) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [leaseId, userId, prop.id, start_date || new Date().toISOString().split('T')[0], end_date || '', prop.rent_amount, deposit || 0],
              () => {
                db.run('UPDATE properties SET status = "occupied" WHERE id = ?', [prop.id]);
              }
            );
          }
        });
      }

      logActivity(req.user.id, 'create_tenant', 'user', userId, `Tenant ${name} onboarded`, req.ip, 'new_entry');
      createNotification(userId, 'Welcome!', `Welcome to the estate, ${name}! Your account is ready.`, 'success');
      res.status(201).json({ id: userId, message: 'Tenant created successfully' });
    }
  );
};

// PUT /api/tenants/:id — admin
const updateTenant = (req, res) => {
  const { name, phone, is_active } = req.body;
  const updates = ['updated_at = datetime("now")'];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
  if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  values.push(req.params.id);

  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ? AND role = 'tenant'`, values, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Tenant not found' });
    logActivity(req.user.id, 'update_tenant', 'user', req.params.id, 'Tenant record updated', req.ip);
    res.json({ message: 'Tenant updated' });
  });
};

// DELETE /api/tenants/:id — soft delete
const deleteTenant = (req, res) => {
  db.run("UPDATE users SET is_active = 0 WHERE id = ? AND role = 'tenant'", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Tenant not found' });
    logActivity(req.user.id, 'deactivate_tenant', 'user', req.params.id, 'Tenant deactivated', req.ip);
    res.json({ message: 'Tenant deactivated' });
  });
};

module.exports = { getAllTenants, getTenant, createTenant, updateTenant, deleteTenant };
