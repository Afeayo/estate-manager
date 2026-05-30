// src/controllers/leasesController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

// GET /api/leases
const getLeases = (req, res) => {
  let where = 'WHERE 1=1';
  const params = [];
  if (req.user.role === 'tenant') { where += ' AND l.tenant_id = ?'; params.push(req.user.id); }

  db.all(
    `SELECT l.*, u.name as tenant_name, u.email as tenant_email, p.unit_number, p.block
     FROM leases l
     JOIN users u ON u.id = l.tenant_id
     JOIN properties p ON p.id = l.property_id
     ${where}
     ORDER BY l.created_at DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// GET /api/leases/:id
const getLease = (req, res) => {
  let where = 'l.id = ?';
  const params = [req.params.id];
  if (req.user.role === 'tenant') { where += ' AND l.tenant_id = ?'; params.push(req.user.id); }

  db.get(
    `SELECT l.*, u.name as tenant_name, u.email as tenant_email, u.phone as tenant_phone,
      p.unit_number, p.block, p.floor, p.bedrooms, p.bathrooms, p.rent_amount
     FROM leases l
     JOIN users u ON u.id = l.tenant_id
     JOIN properties p ON p.id = l.property_id
     WHERE ${where}`,
    params,
    (err, lease) => {
      if (err || !lease) return res.status(404).json({ error: 'Lease not found' });
      res.json(lease);
    }
  );
};

// POST /api/leases
const createLease = (req, res) => {
  const { tenant_id, property_id, start_date, end_date, monthly_rent, deposit } = req.body;
  if (!tenant_id || !property_id || !start_date || !end_date || !monthly_rent)
    return res.status(400).json({ error: 'All fields required' });

  // Check property availability
  db.get("SELECT status FROM properties WHERE id = ?", [property_id], (err, prop) => {
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    if (prop.status === 'occupied') return res.status(400).json({ error: 'Property already occupied' });

    // Terminate any existing active lease for tenant
    db.run("UPDATE leases SET status='terminated' WHERE tenant_id=? AND status='active'", [tenant_id]);

    const id = uuidv4();
    db.run(
      'INSERT INTO leases (id, tenant_id, property_id, start_date, end_date, monthly_rent, deposit) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, tenant_id, property_id, start_date, end_date, monthly_rent, deposit || 0],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        db.run("UPDATE properties SET status='occupied' WHERE id=?", [property_id]);
        logActivity(req.user.id, 'create_lease', 'lease', id, `New lease for property ${property_id}`, req.ip, 'new_entry');
        createNotification(tenant_id, 'Lease Created', `Your lease starts ${start_date} and ends ${end_date}.`, 'success');
        res.status(201).json({ id, message: 'Lease created' });
      }
    );
  });
};

// PUT /api/leases/:id
const updateLease = (req, res) => {
  const { end_date, monthly_rent, deposit, status } = req.body;
  const updates = ['updated_at = datetime("now")'];
  const values = [];

  if (end_date) { updates.push('end_date = ?'); values.push(end_date); }
  if (monthly_rent) { updates.push('monthly_rent = ?'); values.push(monthly_rent); }
  if (deposit !== undefined) { updates.push('deposit = ?'); values.push(deposit); }
  if (status) {
    updates.push('status = ?'); values.push(status);
    if (status === 'terminated' || status === 'expired') {
      // Free up property
      db.get('SELECT property_id, tenant_id FROM leases WHERE id=?', [req.params.id], (e, l) => {
        if (l) {
          db.run("UPDATE properties SET status='vacant' WHERE id=?", [l.property_id]);
          createNotification(l.tenant_id, 'Lease Update', `Your lease has been marked as ${status}.`, 'warning');
        }
      });
    }
  }
  values.push(req.params.id);

  db.run(`UPDATE leases SET ${updates.join(', ')} WHERE id = ?`, values, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Lease not found' });
    res.json({ message: 'Lease updated' });
  });
};

module.exports = { getLeases, getLease, createLease, updateLease };
