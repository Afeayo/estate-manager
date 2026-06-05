'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');
const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  if (!process.env.SMTP_USER || !to) return false;
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST||'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await t.sendMail({ from: process.env.EMAIL_FROM||'EstateManager <noreply@estate.com>', to, subject, html });
    return true;
  } catch(e) { console.log('Email error:', e.message); return false; }
};

// ── Access Cards ───────────────────────────────────────────
const getAccessCards = (req, res) => {
  let where = 'WHERE 1=1'; const params = [];
  if (req.user.role==='tenant') { where += ' AND ac.tenant_id=?'; params.push(req.user.id); }
  db.all(`SELECT ac.*, u.name as tenant_name, p.unit_number
    FROM access_cards ac JOIN users u ON u.id=ac.tenant_id
    LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    ${where} ORDER BY ac.created_at DESC`, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

const createAccessCard = (req, res) => {
  const { card_number, type='physical', tenant_id, card_uid } = req.body;
  const owner = req.user.role==='admin' ? tenant_id : req.user.id;
  if (!owner) return res.status(400).json({ error: 'Tenant ID required' });
  if (!card_number) return res.status(400).json({ error: 'Card number required' });
  const id = uuidv4();
  db.run('INSERT INTO access_cards (id,tenant_id,card_number,card_uid,type) VALUES (?,?,?,?,?)',
    [id, owner, card_number, card_uid||null, type], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Card number already exists' });
        return res.status(500).json({ error: err.message });
      }
      createNotification(owner, 'Access Card Issued', `Your ${type} access card ${card_number} is now active.`, 'success');
      res.status(201).json({ id, message: 'Access card created' });
    }
  );
};

const updateAccessCard = (req, res) => {
  const { status } = req.body;
  db.run('UPDATE access_cards SET status=? WHERE id=?', [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes===0) return res.status(404).json({ error: 'Card not found' });
    res.json({ message: `Card ${status}` });
  });
};

const deleteAccessCard = (req, res) => {
  db.run('DELETE FROM access_cards WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Card deleted' });
  });
};

// ── Visitor Codes ──────────────────────────────────────────
const getVisitorCodes = (req, res) => {
  let where = 'WHERE 1=1'; const params = [];
  if (req.user.role==='tenant') { where += ' AND vc.tenant_id=?'; params.push(req.user.id); }
  db.all(`SELECT vc.*, u.name as tenant_name, p.unit_number
    FROM visitor_codes vc JOIN users u ON u.id=vc.tenant_id
    LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    ${where} ORDER BY vc.created_at DESC`, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // Auto-expire old codes
      db.run("UPDATE visitor_codes SET status='expired' WHERE valid_until < datetime('now') AND status='active'");
      res.json(rows);
    }
  );
};

const createVisitorCode = async (req, res) => {
  const { visitor_name, visitor_phone, visitor_email, valid_until, max_uses=1 } = req.body;
  if (!valid_until) return res.status(400).json({ error: 'valid_until is required' });

  // Generate 6-char alphanumeric code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const id = uuidv4();
  const valid_from = new Date().toISOString();

  db.run(`INSERT INTO visitor_codes (id,tenant_id,code,visitor_name,visitor_phone,visitor_email,valid_from,valid_until,max_uses)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, req.user.id, code, visitor_name||null, visitor_phone||null, visitor_email||null, valid_from, valid_until, max_uses],
    async function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Get tenant + unit info for the message
      db.get(`SELECT u.name, p.unit_number, p.block
        FROM users u
        LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
        LEFT JOIN properties p ON p.id=l.property_id
        WHERE u.id=?`, [req.user.id], async (e, info) => {

        const expiryDate = new Date(valid_until).toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });
        const estateUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        const unitInfo = info?.unit_number ? `Unit ${info.unit_number}` : 'the estate';

        const message = `Hello${visitor_name ? ' '+visitor_name : ''}! 👋\n\n${info?.name || 'Your host'} has invited you to visit them at *EstateManager Estate* (${unitInfo}).\n\n🔑 *Your Access Code:* *${code}*\n\n📅 Valid until: ${expiryDate}\n🔢 Uses remaining: ${max_uses}\n\nPresent this code at the gate entrance to gain access.\n\n_Do not share this code with anyone else._`;

        const whatsappUrl = visitor_phone
          ? `https://wa.me/${visitor_phone.replace(/[^0-9]/g,'')}?text=${encodeURIComponent(message)}`
          : null;

        // Send email if visitor_email provided
        let emailSent = false;
        if (visitor_email) {
          emailSent = await sendEmail(visitor_email, `Your Gate Access Code — ${code}`, `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
              <div style="background:#00361a;padding:20px 24px;border-radius:10px 10px 0 0">
                <h1 style="color:white;margin:0;font-size:20px">🏠 EstateManager</h1>
              </div>
              <div style="padding:24px;background:#f9fafb;border-radius:0 0 10px 10px">
                <p>Hello${visitor_name ? ' '+visitor_name : ''},</p>
                <p><strong>${info?.name||'Your host'}</strong> has invited you to visit them at <strong>${unitInfo}</strong>.</p>
                <div style="background:white;border-radius:12px;padding:20px;text-align:center;margin:20px 0;border:2px solid #00361a">
                  <p style="margin:0;color:#666;font-size:14px">Your Gate Access Code</p>
                  <p style="font-size:42px;font-weight:900;color:#00361a;letter-spacing:8px;margin:10px 0">${code}</p>
                  <p style="margin:0;color:#666;font-size:13px">Valid until: <strong>${expiryDate}</strong></p>
                  <p style="margin:4px 0;color:#666;font-size:13px">Max uses: <strong>${max_uses}</strong></p>
                </div>
                <p style="font-size:13px;color:#666">Present this code at the estate gate. Do not share with others.</p>
              </div>
            </div>`);
          if (emailSent) db.run('UPDATE visitor_codes SET email_sent=1 WHERE id=?', [id]);
        }

        logActivity(req.user.id, 'create_visitor_code', 'visitor_code', id, `Code ${code} for ${visitor_name||'visitor'}`, req.ip, 'new_entry');

        res.status(201).json({
          id, code, message: 'Visitor code generated',
          whatsapp_url: whatsappUrl,
          email_sent: emailSent,
          share_message: message
        });
      });
    }
  );
};

// POST /api/access/visitor-codes/:id/resend — resend via email
const resendVisitorCode = async (req, res) => {
  db.get(`SELECT vc.*, u.name as tenant_name, p.unit_number
    FROM visitor_codes vc JOIN users u ON u.id=vc.tenant_id
    LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    WHERE vc.id=? AND vc.tenant_id=?`, [req.params.id, req.user.id], async (err, vc) => {
      if (!vc) return res.status(404).json({ error: 'Code not found' });

      const expiryDate = new Date(vc.valid_until).toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });
      const unitInfo = vc.unit_number ? `Unit ${vc.unit_number}` : 'the estate';

      if (vc.visitor_email) {
        const sent = await sendEmail(vc.visitor_email, `Your Gate Access Code — ${vc.code}`, `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px">
            <h2 style="color:#00361a">Your Access Code</h2>
            <div style="background:#f0fdf4;border:2px solid #00361a;border-radius:12px;padding:20px;text-align:center;margin:16px 0">
              <p style="font-size:42px;font-weight:900;color:#00361a;letter-spacing:8px;margin:0">${vc.code}</p>
              <p style="color:#666;margin-top:8px">Valid until ${expiryDate}</p>
            </div>
            <p>Use this code at the gate of <strong>${unitInfo}</strong> hosted by <strong>${vc.tenant_name}</strong>.</p>
          </div>`);
        res.json({ success: sent, message: sent ? 'Code resent to '+vc.visitor_email : 'Email failed — check SMTP settings' });
      } else {
        res.status(400).json({ error: 'No email address on record for this visitor' });
      }
    }
  );
};

const revokeVisitorCode = (req, res) => {
  const where = req.user.role==='tenant' ? 'id=? AND tenant_id=?' : 'id=?';
  const params = req.user.role==='tenant' ? [req.params.id, req.user.id] : [req.params.id];
  db.run(`UPDATE visitor_codes SET status='revoked' WHERE ${where}`, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes===0) return res.status(404).json({ error: 'Code not found' });
    res.json({ message: 'Visitor code revoked' });
  });
};

// POST /api/access/verify — gate scanner
const verifyAccess = (req, res) => {
  const { identifier, direction='entry' } = req.body;
  if (!identifier) return res.status(400).json({ error: 'identifier required' });
  const logId = uuidv4();

  db.get(`SELECT ac.*, u.name as tenant_name, p.unit_number
    FROM access_cards ac JOIN users u ON u.id=ac.tenant_id
    LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    WHERE (ac.card_number=? OR ac.card_uid=?) AND ac.status='active'`,
    [identifier, identifier], (err, card) => {
      if (card) {
        db.run('INSERT INTO access_logs (id,person_id,card_id,access_type,direction,status) VALUES (?,?,?,"card",?,"granted")',
          [logId, card.tenant_id, card.id, direction]);
        db.run('UPDATE access_cards SET last_used=datetime("now") WHERE id=?', [card.id]);
        return res.json({ granted:true, type:'card', tenant:card.tenant_name, unit:card.unit_number, beep:'short', led:'green' });
      }

      db.get(`SELECT vc.*, u.name as tenant_name, p.unit_number
        FROM visitor_codes vc JOIN users u ON u.id=vc.tenant_id
        LEFT JOIN leases l ON l.tenant_id=u.id AND l.status='active'
        LEFT JOIN properties p ON p.id=l.property_id
        WHERE vc.code=? AND vc.status='active' AND vc.valid_until>=datetime('now')
          AND vc.used_count < vc.max_uses`,
        [identifier.toUpperCase()], (err2, vc) => {
          if (vc) {
            db.run('UPDATE visitor_codes SET used_count=used_count+1 WHERE id=?', [vc.id]);
            db.run('INSERT INTO access_logs (id,visitor_code_id,access_type,direction,status) VALUES (?,?,"visitor_code",?,"granted")',
              [logId, vc.id, direction]);
            return res.json({ granted:true, type:'visitor_code', visitor:vc.visitor_name, host:vc.tenant_name, beep:'short', led:'green' });
          }
          db.run('INSERT INTO access_logs (id,access_type,direction,status,notes) VALUES (?,"manual",?,"denied",?)',
            [logId, direction, `Unknown: ${identifier}`]);
          res.json({ granted:false, beep:'long', led:'red', message:'Access denied' });
        }
      );
    }
  );
};

const getAccessLogs = (req, res) => {
  const { limit=50, page=1 } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const params = [];
  if (req.user.role==='tenant') {
    where += ' AND (ac.tenant_id=? OR vc.tenant_id=?)';
    params.push(req.user.id, req.user.id);
  }
  db.all(`SELECT al.*, u.name as tenant_name, ac.card_number, vc.code as visitor_code, vc.visitor_name
    FROM access_logs al
    LEFT JOIN access_cards ac ON ac.id=al.card_id
    LEFT JOIN visitor_codes vc ON vc.id=al.visitor_code_id
    LEFT JOIN users u ON u.id=COALESCE(al.person_id, ac.tenant_id, vc.tenant_id)
    ${where} ORDER BY al.timestamp DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

module.exports = {
  getAccessCards, createAccessCard, updateAccessCard, deleteAccessCard,
  getVisitorCodes, createVisitorCode, resendVisitorCode, revokeVisitorCode,
  verifyAccess, getAccessLogs
};
