// src/controllers/nfcController.js — NFC Hardware Integration
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

// Forward command to physical NFC hardware device
const sendToDevice = (device, endpoint, payload) => new Promise((resolve, reject) => {
  const data = JSON.stringify(payload);
  const options = {
    hostname: device.ip_address,
    port: device.port || 8080,
    path: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'X-API-Key': device.api_key || ''
    },
    timeout: 5000
  };
  const req = http.request(options, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ success: true }); } });
  });
  req.on('error', reject);
  req.on('timeout', () => { req.destroy(); reject(new Error('Device timeout')); });
  req.write(data); req.end();
});

// ─── DEVICE MANAGEMENT ───────────────────────────────────

// GET /api/nfc/devices
const getDevices = (req, res) => {
  db.all('SELECT * FROM nfc_devices ORDER BY device_name', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
};

// POST /api/nfc/devices
const addDevice = (req, res) => {
  const { device_name, device_type, location, ip_address, port, api_key, firmware_version } = req.body;
  if (!device_name || !ip_address) return res.status(400).json({ error: 'device_name and ip_address required' });
  const id = uuidv4();
  db.run('INSERT INTO nfc_devices (id,device_name,device_type,location,ip_address,port,api_key,firmware_version) VALUES (?,?,?,?,?,?,?,?)',
    [id, device_name, device_type || 'reader', location, ip_address, port || 8080, api_key, firmware_version],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      logActivity(req.user.id, 'add_nfc_device', 'device', id, `Device ${device_name} added at ${ip_address}`, req.ip, 'new_entry');
      res.status(201).json({ id, message: 'NFC device registered' });
    }
  );
};

// PUT /api/nfc/devices/:id
const updateDevice = (req, res) => {
  const { device_name, location, ip_address, port, api_key, status } = req.body;
  db.run(`UPDATE nfc_devices SET
    device_name=COALESCE(?,device_name), location=COALESCE(?,location),
    ip_address=COALESCE(?,ip_address), port=COALESCE(?,port),
    api_key=COALESCE(?,api_key), status=COALESCE(?,status),
    updated_at=datetime('now') WHERE id=?`,
    [device_name, location, ip_address, port, api_key, status, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Device updated' });
    }
  );
};

// DELETE /api/nfc/devices/:id
const deleteDevice = (req, res) => {
  db.run('DELETE FROM nfc_devices WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Device removed' });
  });
};

// POST /api/nfc/devices/:id/ping — test connectivity
const pingDevice = async (req, res) => {
  db.get('SELECT * FROM nfc_devices WHERE id=?', [req.params.id], async (err, device) => {
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
      await sendToDevice(device, '/ping', { timestamp: Date.now() });
      db.run("UPDATE nfc_devices SET status='online', last_heartbeat=datetime('now') WHERE id=?", [device.id]);
      res.json({ online: true, device_name: device.device_name, ip: device.ip_address });
    } catch (e) {
      db.run("UPDATE nfc_devices SET status='offline' WHERE id=?", [device.id]);
      res.json({ online: false, error: e.message });
    }
  });
};

// ─── CARD PROVISIONING TO HARDWARE ──────────────────────

// POST /api/nfc/provision/:card_id — push card UID to all active devices
const provisionCard = async (req, res) => {
  db.get(`SELECT ac.*, u.name as tenant_name, p.unit_number
    FROM access_cards ac JOIN users u ON u.id=ac.tenant_id
    LEFT JOIN leases l ON l.tenant_id=ac.tenant_id AND l.status='active'
    LEFT JOIN properties p ON p.id=l.property_id
    WHERE ac.id=?`, [req.params.card_id], async (err, card) => {
    if (!card) return res.status(404).json({ error: 'Card not found' });

    db.all("SELECT * FROM nfc_devices WHERE status='online'", [], async (e, devices) => {
      const results = [];
      for (const device of (devices || [])) {
        try {
          await sendToDevice(device, '/cards/add', {
            card_uid: card.card_uid || card.card_number,
            card_id: card.id,
            tenant_name: card.tenant_name,
            unit: card.unit_number,
            access_level: 1
          });
          results.push({ device: device.device_name, success: true });
        } catch (e2) {
          results.push({ device: device.device_name, success: false, error: e2.message });
        }
      }
      res.json({ message: `Card provisioned to ${results.filter(r => r.success).length}/${devices.length} devices`, results });
    });
  });
};

// POST /api/nfc/revoke/:card_id — revoke card from all devices
const revokeCardFromDevices = async (req, res) => {
  db.get('SELECT * FROM access_cards WHERE id=?', [req.params.card_id], async (err, card) => {
    if (!card) return res.status(404).json({ error: 'Card not found' });

    db.all("SELECT * FROM nfc_devices WHERE status='online'", [], async (e, devices) => {
      for (const device of (devices || [])) {
        try {
          await sendToDevice(device, '/cards/remove', { card_uid: card.card_uid || card.card_number });
        } catch (_) {}
      }
      db.run("UPDATE access_cards SET status='suspended' WHERE id=?", [card.id]);
      res.json({ message: 'Card revoked from all devices' });
    });
  });
};

// ─── HARDWARE GATE CONTROL ───────────────────────────────

// POST /api/nfc/gate/:device_id/open — trigger gate/door open
const openGate = async (req, res) => {
  const { duration = 5, reason = 'manual' } = req.body;
  db.get('SELECT * FROM nfc_devices WHERE id=?', [req.params.device_id], async (err, device) => {
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
      await sendToDevice(device, '/gate/open', { duration_seconds: duration, triggered_by: req.user.name, reason });
      db.run("INSERT INTO access_logs (id,person_id,device_id,access_type,direction,status,notes) VALUES (?,?,?,'manual','entry','granted',?)",
        [uuidv4(), req.user.id, device.id, `Manual open by ${req.user.name}: ${reason}`]);
      logActivity(req.user.id, 'gate_opened', 'device', device.id, `Gate opened: ${device.device_name}`, req.ip);
      res.json({ message: `Gate ${device.device_name} opened for ${duration}s` });
    } catch (e) {
      res.status(503).json({ error: `Cannot reach device: ${e.message}` });
    }
  });
};

// POST /api/nfc/heartbeat — devices call this to update their status
const heartbeat = (req, res) => {
  const { device_id, firmware_version, status = 'online' } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  db.run("UPDATE nfc_devices SET status=?, last_heartbeat=datetime('now'), firmware_version=COALESCE(?,firmware_version), updated_at=datetime('now') WHERE id=?",
    [status, firmware_version, device_id], function(err) {
      if (this.changes === 0) {
        // Auto-register unknown device
        db.run('INSERT OR IGNORE INTO nfc_devices (id,device_name,ip_address,status,last_heartbeat) VALUES (?,?,?,?,datetime("now"))',
          [device_id, `Device-${device_id.slice(0,8)}`, req.ip, status]);
      }
      res.json({ message: 'ok', timestamp: new Date().toISOString() });
    }
  );
};

// POST /api/nfc/scan — hardware posts a scan event
const processScan = (req, res) => {
  const { card_uid, device_id, direction = 'entry' } = req.body;
  if (!card_uid) return res.status(400).json({ error: 'card_uid required' });

  // Lookup by card_uid or card_number
  db.get(`SELECT ac.*, u.name as tenant_name, u.is_active,
    (SELECT onboarding_status FROM users WHERE id=ac.tenant_id) as onboard_status
    FROM access_cards ac JOIN users u ON u.id=ac.tenant_id
    WHERE (ac.card_uid=? OR ac.card_number=?) AND ac.status='active'`, [card_uid, card_uid],
    (err, card) => {
      const logId = uuidv4();
      if (card && card.is_active && card.onboard_status === 'active') {
        db.run('INSERT INTO access_logs (id,person_id,card_id,device_id,access_type,direction,status) VALUES (?,?,?,?,?,?,?)',
          [logId, card.tenant_id, card.id, device_id, card.type || 'nfc', direction, 'granted']);
        db.run('UPDATE access_cards SET last_used=datetime("now") WHERE id=?', [card.id]);

        // Send response to hardware
        res.json({ granted: true, tenant: card.tenant_name, uid: card.card_uid, beep: 'short', led: 'green' });
      } else {
        db.run('INSERT INTO access_logs (id,device_id,access_type,direction,status,notes) VALUES (?,?,?,?,?,?)',
          [logId, device_id, 'nfc', direction, 'denied', `Unknown/inactive card: ${card_uid}`]);
        res.json({ granted: false, beep: 'long', led: 'red' });
      }
    }
  );
};

module.exports = { getDevices, addDevice, updateDevice, deleteDevice, pingDevice, provisionCard, revokeCardFromDevices, openGate, heartbeat, processScan };
