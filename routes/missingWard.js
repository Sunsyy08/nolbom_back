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
      w.gender        AS gender,
      u.birthdate     AS birthdate,
      u.height        AS height,
      u.weight        AS weight,
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

// checkDb.js (앱 초기화 때 한 번만 실행)
db.serialize(() => {
    db.run(`ALTER TABLE users ADD COLUMN height REAL;`, err => {
      // 이미 컬럼이 있으면 에러 무시
      if (err && !/duplicate column/.test(err.message)) {
        console.error('height 컬럼 추가 실패:', err);
      }
    });
    db.run(`ALTER TABLE users ADD COLUMN weight REAL;`, err => {
      if (err && !/duplicate column/.test(err.message)) {
        console.error('weight 컬럼 추가 실패:', err);
      }
    });
  });
  

module.exports = router;
