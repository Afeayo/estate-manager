// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// POST /api/auth/login
const login = (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  db.get('SELECT * FROM users WHERE email=?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated. Contact management.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    db.run("UPDATE users SET last_login=datetime('now') WHERE id=?", [user.id]);
    logActivity(user.id, 'login', 'user', user.id, `${user.name} logged in`, req.ip, 'success');

    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, avatar: user.avatar, phone: user.phone,
        onboarding_status: user.onboarding_status
      }
    });
  });
};

// POST /api/auth/register
const register = async (req, res) => {
  const { name, email, password, role = 'tenant', phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });

  const hash = await bcrypt.hash(password, 12);
  const id = uuidv4();

  db.run('INSERT INTO users (id,name,email,password,role,phone,onboarding_status) VALUES (?,?,?,?,?,?,?)',
    [id, name, email, hash, role, phone || null, role === 'tenant' ? 'pending' : 'active'],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
        return res.status(500).json({ error: 'Registration failed' });
      }
      const token = jwt.sign({ id, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      logActivity(id, 'register', 'user', id, `New ${role} registered: ${name}`, req.ip, 'new_entry');
      res.status(201).json({
        token,
        user: { id, name, email, role, phone, onboarding_status: role === 'tenant' ? 'pending' : 'active' }
      });
    }
  );
};

// GET /api/auth/me
const getMe = (req, res) => {
  db.get(`SELECT u.id, u.name, u.email, u.role, u.phone, u.avatar, u.last_login,
      u.onboarding_status, u.created_at,
      p.unit_number, p.block, p.floor, l.id as lease_id, l.end_date, l.monthly_rent
    FROM users u
    LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    WHERE u.id=?`, [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  const { name, phone } = req.body;
  const avatar = req.file ? `/uploads/${req.file.filename}` : undefined;
  const updates = ["updated_at=datetime('now')"];
  const values = [];
  if (name) { updates.push('name=?'); values.push(name); }
  if (phone) { updates.push('phone=?'); values.push(phone); }
  if (avatar) { updates.push('avatar=?'); values.push(avatar); }
  values.push(req.user.id);
  db.run(`UPDATE users SET ${updates.join(',')} WHERE id=?`, values, function(err) {
    if (err) return res.status(500).json({ error: 'Update failed' });
    res.json({ message: 'Profile updated' });
  });
};

// PUT /api/auth/change-password
const changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  db.get('SELECT password FROM users WHERE id=?', [req.user.id], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(current_password, user.password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    db.run('UPDATE users SET password=? WHERE id=?', [hash, req.user.id], err => {
      if (err) return res.status(500).json({ error: 'Update failed' });
      res.json({ message: 'Password changed successfully' });
    });
  });
};

module.exports = { login, register, getMe, updateProfile, changePassword };
