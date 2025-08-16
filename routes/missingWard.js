// routes/missingWard.js
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middlewares/auth');

router.get('/', auth, (req, res) => {
  const sql = `
    SELECT
      m.id            AS missing_id,
      w.id            AS ward_id,
      u.name,
      u.gender        AS gender,
      u.birthdate     AS birthdate,
      COALESCE(u.height, w.height, 0) AS height,
      COALESCE(u.weight, w.weight, 0) AS weight,
      m.detected_at,
      m.last_lat,
      m.last_lng,
      m.status,
      m.notes,
      m.updated_at
    FROM missing_wards m
    JOIN wards w ON m.ward_id = w.id
    JOIN users u ON w.user_id = u.id
    ORDER BY m.detected_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('실종자 조회 오류:', err);
      return res.status(500).json({ error: '실종자 조회 중 오류가 발생했습니다.' });
    }
    res.json({ missingWards: rows });
  });
});

module.exports = router;