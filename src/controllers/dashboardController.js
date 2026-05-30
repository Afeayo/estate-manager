// src/controllers/dashboardController.js
const db = require('../config/database');

// GET /api/dashboard/admin
const getAdminDashboard = (req, res) => {
  const queries = {
    overview: `
      SELECT
        (SELECT COUNT(*) FROM properties) as total_apartments,
        (SELECT COUNT(*) FROM users WHERE role='tenant' AND is_active=1) as total_tenants,
        (SELECT COUNT(*) FROM properties WHERE status='occupied') as occupied,
        (SELECT COUNT(*) FROM properties WHERE status='vacant') as vacant,
        (SELECT COUNT(*) FROM bills WHERE status='pending') as pending_bills,
        (SELECT ROUND(SUM(amount),2) FROM bills WHERE status='paid'
          AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')) as revenue_this_month,
        (SELECT ROUND(SUM(amount),2) FROM bills WHERE status IN ('pending','overdue')) as outstanding_amount,
        (SELECT COUNT(*) FROM complaints WHERE status NOT IN ('resolved','closed')) as open_complaints
    `,
    recentActivity: `
      SELECT al.action, al.details, al.status, al.entity_type, al.created_at, u.name as user_name, u.role as user_role
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC LIMIT 10
    `,
    occupancyTrend: `
      SELECT strftime('%Y-%m', l.start_date) as month, COUNT(*) as new_tenants
      FROM leases l WHERE l.start_date >= date('now', '-6 months')
      GROUP BY month ORDER BY month
    `,
    revenueByMonth: `
      SELECT strftime('%Y-%m', paid_at) as month, SUM(amount) as revenue, COUNT(*) as transactions
      FROM bills WHERE status='paid' AND paid_at >= date('now', '-6 months')
      GROUP BY month ORDER BY month
    `,
    billsByStatus: `
      SELECT status, COUNT(*) as count, SUM(amount) as total FROM bills GROUP BY status
    `,
    complaintsByStatus: `
      SELECT status, COUNT(*) as count FROM complaints GROUP BY status
    `
  };

  const result = {};
  let done = 0;
  const total = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, sql]) => {
    const method = key === 'overview' ? 'get' : 'all';
    db[method](sql, [], (err, data) => {
      result[key] = err ? null : data;
      if (++done === total) res.json(result);
    });
  });
};

// GET /api/dashboard/tenant
const getTenantDashboard = (req, res) => {
  const id = req.user.id;

  db.get(
    `SELECT u.name, u.email, u.phone, u.avatar,
      p.unit_number, p.block, p.floor, p.bedrooms,
      l.start_date, l.end_date, l.monthly_rent, l.status as lease_status
     FROM users u
     LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active'
     LEFT JOIN properties p ON p.id = l.property_id
     WHERE u.id = ?`,
    [id],
    (err, profile) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all(
        "SELECT id, title, amount, due_date, status, category FROM bills WHERE tenant_id=? AND status IN ('pending','overdue') ORDER BY due_date ASC LIMIT 5",
        [id],
        (e1, pendingBills) => {
          db.all(
            "SELECT id, title, status, priority, created_at FROM complaints WHERE tenant_id=? ORDER BY created_at DESC LIMIT 5",
            [id],
            (e2, recentComplaints) => {
              db.all(
                "SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
                [id],
                (e3, notifications) => {
                  db.get(
                    "SELECT SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as paid, SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) as pending FROM bills WHERE tenant_id=?",
                    [id],
                    (e4, billSummary) => {
                      res.json({ profile, pendingBills, recentComplaints, notifications, billSummary });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
};

// GET /api/dashboard/maintenance
const getMaintenanceDashboard = (req, res) => {
  db.all(
    `SELECT c.*, u.name as tenant_name, p.unit_number
     FROM complaints c
     JOIN users u ON u.id = c.tenant_id
     LEFT JOIN properties p ON p.id = c.property_id
     WHERE c.status IN ('open','in_progress') OR c.assigned_to = ?
     ORDER BY CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, c.created_at ASC`,
    [req.user.id],
    (err, tasks) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved, SUM(CASE WHEN assigned_to=? THEN 1 ELSE 0 END) as mine FROM complaints",
        [req.user.id],
        (e, stats) => {
          res.json({ tasks, stats });
        }
      );
    }
  );
};

module.exports = { getAdminDashboard, getTenantDashboard, getMaintenanceDashboard };
