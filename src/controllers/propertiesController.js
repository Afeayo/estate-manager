// src/controllers/propertiesController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity } = require('../utils/helpers');

// GET /api/properties
const getAllProperties = (req, res) => {
  const { status, search } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (status) { where += ' AND p.status = ?'; params.push(status); }
  if (search) { where += ' AND (p.unit_number LIKE ? OR p.block LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  db.all(
    `SELECT p.*,
      u.id as tenant_id, u.name as tenant_name, u.email as tenant_email,
      l.id as lease_id, l.end_date, l.monthly_rent
     FROM properties p
     LEFT JOIN leases l ON l.property_id = p.id AND l.status = 'active'
     LEFT JOIN users u ON u.id = l.tenant_id
     ${where}
     ORDER BY p.unit_number`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// GET /api/properties/stats
const getPropertyStats = (req, res) => {
  db.get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status='vacant' THEN 1 ELSE 0 END) as vacant,
      SUM(CASE WHEN status='maintenance' THEN 1 ELSE 0 END) as in_maintenance,
      SUM(rent_amount) as total_potential_revenue,
      ROUND(SUM(CASE WHEN status='occupied' THEN rent_amount ELSE 0 END),2) as current_revenue
    FROM properties
  `, (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(stats);
  });
};

// GET /api/properties/:id
const getProperty = (req, res) => {
  db.get(
    `SELECT p.*,
      u.id as tenant_id, u.name as tenant_name, u.email as tenant_email, u.phone as tenant_phone,
      l.id as lease_id, l.start_date, l.end_date, l.monthly_rent, l.deposit
     FROM properties p
     LEFT JOIN leases l ON l.property_id = p.id AND l.status = 'active'
     LEFT JOIN users u ON u.id = l.tenant_id
     WHERE p.id = ?`,
    [req.params.id],
    (err, prop) => {
      if (err || !prop) return res.status(404).json({ error: 'Property not found' });
      res.json(prop);
    }
  );
};

// POST /api/properties
const createProperty = (req, res) => {
  const { unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, description, amenities } = req.body;
  if (!unit_number || !rent_amount) return res.status(400).json({ error: 'Unit number and rent amount required' });

  const id = uuidv4();
  db.run(
    'INSERT INTO properties (id, unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, description, amenities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, unit_number, block, floor, bedrooms || 1, bathrooms || 1, size_sqft, rent_amount, description, amenities],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Unit number already exists' });
        return res.status(500).json({ error: err.message });
      }
      logActivity(req.user.id, 'create_property', 'property', id, `Property ${unit_number} added`, req.ip, 'new_entry');
      res.status(201).json({ id, message: 'Property created' });
    }
  );
};

// PUT /api/properties/:id
const updateProperty = (req, res) => {
  const { unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, status, description, amenities } = req.body;
  db.run(
    `UPDATE properties SET
      unit_number = COALESCE(?, unit_number),
      block = COALESCE(?, block),
      floor = COALESCE(?, floor),
      bedrooms = COALESCE(?, bedrooms),
      bathrooms = COALESCE(?, bathrooms),
      size_sqft = COALESCE(?, size_sqft),
      rent_amount = COALESCE(?, rent_amount),
      status = COALESCE(?, status),
      description = COALESCE(?, description),
      amenities = COALESCE(?, amenities),
      updated_at = datetime('now')
     WHERE id = ?`,
    [unit_number, block, floor, bedrooms, bathrooms, size_sqft, rent_amount, status, description, amenities, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Property not found' });
      logActivity(req.user.id, 'update_property', 'property', req.params.id, 'Property updated', req.ip);
      res.json({ message: 'Property updated' });
    }
  );
};

// DELETE /api/properties/:id
const deleteProperty = (req, res) => {
  db.get("SELECT COUNT(*) as c FROM leases WHERE property_id = ? AND status = 'active'", [req.params.id], (err, row) => {
    if (row?.c > 0) return res.status(400).json({ error: 'Cannot delete an occupied property. Terminate lease first.' });
    db.run('DELETE FROM properties WHERE id = ?', [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Property not found' });
      res.json({ message: 'Property deleted' });
    });
  });
};

module.exports = { getAllProperties, getPropertyStats, getProperty, createProperty, updateProperty, deleteProperty };
