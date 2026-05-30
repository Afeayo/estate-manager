// src/controllers/billsController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

// GET /api/bills — admin gets all; tenant gets own
const getBills = (req, res) => {
  const { status, category, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'tenant') {
    where += ' AND b.tenant_id = ?'; params.push(req.user.id);
  }
  if (status) { where += ' AND b.status = ?'; params.push(status); }
  if (category) { where += ' AND b.category = ?'; params.push(category); }

  db.all(
    `SELECT b.*, u.name as tenant_name, u.email as tenant_email, p.unit_number
     FROM bills b
     JOIN users u ON u.id = b.tenant_id
     LEFT JOIN properties p ON p.id = b.property_id
     ${where}
     ORDER BY b.due_date ASC, b.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(`SELECT COUNT(*) as total FROM bills b ${where}`, params, (e, c) => {
        res.json({ bills: rows, total: c?.total || 0, page: parseInt(page), limit: parseInt(limit) });
      });
    }
  );
};

// GET /api/bills/summary — financial overview for admin
const getBillsSummary = (req, res) => {
  db.all(`
    SELECT
      category,
      SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as paid,
      SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) as pending,
      SUM(CASE WHEN status='overdue' THEN amount ELSE 0 END) as overdue,
      COUNT(*) as count
    FROM bills
    GROUP BY category
  `, (err, byCategory) => {
    db.get(`
      SELECT
        SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status='pending' OR status='overdue' THEN amount ELSE 0 END) as outstanding,
        COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status='overdue' THEN 1 END) as overdue_count,
        COUNT(CASE WHEN status='paid' THEN 1 END) as paid_count
      FROM bills
    `, (err2, totals) => {
      // Monthly revenue (last 6 months)
      db.all(`
        SELECT strftime('%Y-%m', paid_at) as month,
          SUM(amount) as revenue, COUNT(*) as transactions
        FROM bills
        WHERE status='paid' AND paid_at >= date('now','-6 months')
        GROUP BY month ORDER BY month
      `, (err3, monthly) => {
        res.json({ by_category: byCategory, totals, monthly_revenue: monthly });
      });
    });
  });
};

// GET /api/bills/:id
const getBill = (req, res) => {
  let where = 'b.id = ?';
  const params = [req.params.id];
  if (req.user.role === 'tenant') { where += ' AND b.tenant_id = ?'; params.push(req.user.id); }

  db.get(
    `SELECT b.*, u.name as tenant_name, u.email as tenant_email, p.unit_number
     FROM bills b JOIN users u ON u.id = b.tenant_id LEFT JOIN properties p ON p.id=b.property_id
     WHERE ${where}`,
    params,
    (err, bill) => {
      if (err || !bill) return res.status(404).json({ error: 'Bill not found' });
      res.json(bill);
    }
  );
};

// POST /api/bills — admin creates bill(s)
const createBill = (req, res) => {
  const { tenant_id, property_id, title, description, amount, due_date, category = 'rent' } = req.body;
  if (!tenant_id || !title || !amount || !due_date)
    return res.status(400).json({ error: 'tenant_id, title, amount, due_date required' });

  const id = uuidv4();
  db.run(
    'INSERT INTO bills (id, tenant_id, property_id, title, description, amount, due_date, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, tenant_id, property_id, title, description, amount, due_date, category, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      logActivity(req.user.id, 'create_bill', 'bill', id, `Bill "${title}" created for ₦${amount}`, req.ip, 'new_entry');
      createNotification(tenant_id, 'New Bill', `A new ${category} bill of ₦${amount} is due on ${due_date}`, 'payment');
      res.status(201).json({ id, message: 'Bill created' });
    }
  );
};

// POST /api/bills/:id/pay — tenant pays bill
const payBill = (req, res) => {
  const { payment_method = 'online', transaction_ref } = req.body;
  let where = 'id = ? AND status = "pending"';
  const params = [req.params.id];
  if (req.user.role === 'tenant') { where += ' AND tenant_id = ?'; params.push(req.user.id); }

  db.run(
    `UPDATE bills SET status='paid', paid_at=datetime('now'), payment_method=?, transaction_ref=?, updated_at=datetime('now') WHERE ${where}`,
    [payment_method, transaction_ref || uuidv4().slice(0,8).toUpperCase(), ...params],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Bill not found or already paid' });

      logActivity(req.user.id, 'pay_bill', 'bill', req.params.id, `Bill paid via ${payment_method}`, req.ip, 'success');
      res.json({ message: 'Payment successful', transaction_ref });
    }
  );
};

// POST /api/bills/bulk — admin creates bulk bills (e.g., rent for all tenants)
const createBulkBills = (req, res) => {
  const { title, description, category = 'rent', due_date, custom_amount } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: 'title and due_date required' });

  db.all(
    `SELECT u.id as tenant_id, p.id as property_id, l.monthly_rent
     FROM users u
     JOIN leases l ON l.tenant_id = u.id AND l.status='active'
     JOIN properties p ON p.id = l.property_id
     WHERE u.is_active = 1`,
    [],
    (err, tenants) => {
      if (err || !tenants.length) return res.status(400).json({ error: 'No active tenants found' });

      const stmt = db.prepare('INSERT INTO bills (id, tenant_id, property_id, title, description, amount, due_date, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      let count = 0;
      tenants.forEach(t => {
        const id = uuidv4();
        const amount = custom_amount || t.monthly_rent;
        stmt.run([id, t.tenant_id, t.property_id, title, description, amount, due_date, category, req.user.id]);
        createNotification(t.tenant_id, 'New Bill', `${category} bill of ₦${amount} due ${due_date}`, 'payment');
        count++;
      });
      stmt.finalize();

      logActivity(req.user.id, 'bulk_bills', 'bill', null, `Bulk bills created for ${count} tenants`, req.ip, 'success');
      res.status(201).json({ message: `Bills created for ${count} tenants` });
    }
  );
};

// DELETE /api/bills/:id — admin cancels bill
const cancelBill = (req, res) => {
  db.run(
    "UPDATE bills SET status='cancelled', updated_at=datetime('now') WHERE id=? AND status='pending'",
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Bill not found or cannot be cancelled' });
      res.json({ message: 'Bill cancelled' });
    }
  );
};

module.exports = { getBills, getBillsSummary, getBill, createBill, payBill, createBulkBills, cancelBill };
