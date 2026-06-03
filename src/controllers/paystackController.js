// src/controllers/paystackController.js
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const paystackRequest = (method, path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = https.request({
    hostname: 'api.paystack.co', path, method,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
  }, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); } });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

// POST /api/payments/initialize — create Paystack transaction
const initializePayment = async (req, res) => {
  const { bill_id } = req.body;
  if (!bill_id) return res.status(400).json({ error: 'bill_id required' });

  db.get(`SELECT b.*, u.email, u.name FROM bills b JOIN users u ON u.id=b.tenant_id
    WHERE b.id=? AND b.status IN ('pending','overdue')`, [bill_id], async (err, bill) => {
    if (!bill) return res.status(404).json({ error: 'Bill not found or already paid' });
    if (req.user.role === 'tenant' && bill.tenant_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const reference = `EM-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    const amount = Math.round(bill.amount * 100); // Paystack uses kobo

    try {
      if (!PAYSTACK_SECRET) {
        // Demo mode — simulate success
        const ref = `DEMO-${reference}`;
        db.run(`UPDATE bills SET status='paid', paid_at=datetime('now'), payment_method='paystack_card',
          transaction_ref=?, paystack_ref=?, paystack_status='success', updated_at=datetime('now') WHERE id=?`,
          [ref, ref, bill_id]);
        createNotification(bill.tenant_id, 'Payment Successful', `${bill.title} — ${formatNaira(bill.amount)} paid`, 'payment');
        return res.json({ demo: true, reference: ref, message: 'Demo payment successful (set PAYSTACK_SECRET_KEY for live)' });
      }

      const payload = {
        email: bill.email,
        amount,
        reference,
        metadata: { bill_id, tenant_id: bill.tenant_id, bill_title: bill.title },
        callback_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/tenant/bills.html?payment=success`
      };

      const result = await paystackRequest('POST', '/transaction/initialize', payload);
      if (!result.status) return res.status(400).json({ error: result.message });

      // Save reference to bill
      db.run('UPDATE bills SET paystack_ref=?, paystack_status=?, updated_at=datetime(\'now\') WHERE id=?',
        [reference, 'initiated', bill_id]);

      logActivity(req.user.id, 'payment_initiated', 'bill', bill_id, `Paystack initiated: ${reference}`, req.ip, 'pending');
      res.json({ authorization_url: result.data.authorization_url, reference, access_code: result.data.access_code });
    } catch (e) {
      res.status(500).json({ error: 'Payment gateway error: ' + e.message });
    }
  });
};

// GET /api/payments/verify/:reference
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
    let verified = false, amount = 0, status = 'failed';

    if (!PAYSTACK_SECRET || reference.startsWith('DEMO-')) {
      verified = true; status = 'success';
    } else {
      const result = await paystackRequest('GET', `/transaction/verify/${reference}`);
      if (result.status && result.data.status === 'success') {
        verified = true; amount = result.data.amount / 100; status = 'success';
      }
    }

    db.get("SELECT * FROM bills WHERE paystack_ref=? OR transaction_ref=?", [reference, reference], (err, bill) => {
      if (!bill) return res.status(404).json({ error: 'Bill not found for this reference' });

      if (verified) {
        db.run(`UPDATE bills SET status='paid', paid_at=datetime('now'), payment_method='paystack_card',
          transaction_ref=?, paystack_status='success', updated_at=datetime('now') WHERE id=?`,
          [reference, bill.id], () => {
            createNotification(bill.tenant_id, '✅ Payment Confirmed', `${bill.title} — payment verified successfully`, 'payment');
            logActivity(bill.tenant_id, 'payment_verified', 'bill', bill.id, `Paystack verified: ${reference}`, req.ip, 'success');

            // Check if this is deposit/rent for onboarding — auto-activate
            if (bill.category === 'deposit' || bill.category === 'rent') {
              db.get("SELECT * FROM kyc_applications WHERE tenant_id=? AND status='approved'", [bill.tenant_id], (e, kyc) => {
                if (kyc) {
                  db.get("SELECT COUNT(*) as c FROM bills WHERE tenant_id=? AND category IN ('deposit','rent') AND status='paid'", [bill.tenant_id], (e2, row) => {
                    if (row?.c >= 2) {
                      // Auto-activate tenant after both deposit + rent paid
                      const leaseId = uuidv4();
                      const endDate = new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0];
                      db.run('INSERT OR IGNORE INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,deposit) VALUES (?,?,?,date("now"),?,?,?)',
                        [leaseId, kyc.tenant_id, kyc.property_id, endDate, kyc.rent_amount, kyc.rent_amount * 2]);
                      db.run("UPDATE properties SET status='occupied' WHERE id=?", [kyc.property_id]);
                      db.run("UPDATE users SET onboarding_status='active' WHERE id=?", [bill.tenant_id]);
                      createNotification(bill.tenant_id, '🎉 Welcome! Unit Assigned', 'All payments confirmed. Your unit is now active. Welcome home!', 'success');
                    }
                  });
                }
              });
            }
          });
        res.json({ verified: true, message: 'Payment confirmed' });
      } else {
        db.run("UPDATE bills SET paystack_status='failed' WHERE id=?", [bill.id]);
        res.json({ verified: false, message: 'Payment not confirmed' });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/payments/webhook — Paystack webhook
const webhook = (req, res) => {
  const crypto = require('crypto');
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) return res.status(401).send('Invalid signature');

  const { event, data } = req.body;
  if (event === 'charge.success') {
    const ref = data.reference;
    db.get("SELECT * FROM bills WHERE paystack_ref=?", [ref], (err, bill) => {
      if (bill && bill.status !== 'paid') {
        db.run("UPDATE bills SET status='paid', paid_at=datetime('now'), payment_method='paystack_card', paystack_status='success' WHERE id=?", [bill.id]);
        createNotification(bill.tenant_id, 'Payment Received', `${bill.title} payment confirmed via Paystack`, 'payment');
      }
    });
  }
  res.sendStatus(200);
};

const formatNaira = n => '₦' + Number(n || 0).toLocaleString('en-NG');

// GET /api/payments/history
const getPaymentHistory = (req, res) => {
  let where = "WHERE b.status='paid'";
  const params = [];
  if (req.user.role === 'tenant') { where += ' AND b.tenant_id=?'; params.push(req.user.id); }

  db.all(`SELECT b.*, u.name as tenant_name, p.unit_number FROM bills b
    JOIN users u ON u.id=b.tenant_id
    LEFT JOIN properties p ON p.id=b.property_id
    ${where} ORDER BY b.paid_at DESC LIMIT 100`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
};

module.exports = { initializePayment, verifyPayment, webhook, getPaymentHistory };
