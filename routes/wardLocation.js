const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middlewares/auth');

// 📍 거리 계산 함수 (Haversine 공식)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 지구 반지름 (미터)
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 보호자에게 알림 전송 (추후 문자/푸시로 대체 가능)
function notifyGuardian(message) {
  console.log(`[알림] ${message}`);
}

// ✅ 1. 노약자 집 위치 등록 API
// POST /ward/home
router.post('/ward/home', auth, (req, res) => {
  const { lat, lng, radius } = req.body;
  const userId = req.user.user_id;

  if (!lat || !lng) {
    return res.status(400).json({ error: '위도와 경도는 필수입니다' });
  }

  const safeRadius = radius || 100;

  db.get(`SELECT id FROM wards WHERE user_id = ?`, [userId], (err, ward) => {
    if (err || !ward) return res.status(404).json({ error: '노약자 정보 없음' });

    db.run(`
      UPDATE wards
      SET safe_lat = ?, safe_lng = ?, safe_radius = ?
      WHERE id = ?
    `, [lat, lng, safeRadius, ward.id], (err) => {
      if (err) return res.status(500).json({ error: '기준 위치 등록 실패' });
      res.json({ success: true, message: '집 위치 등록 완료' });
    });
  });
});

// ✅ 2. 노약자 현재 위치 기록 및 상태 판단 API
// POST /ward/location
router.post('/ward/location', auth, (req, res) => {
  const { lat, lng } = req.body;
  const userId = req.user.user_id;
  const now = Date.now();

  const sql = `
  SELECT w.id AS ward_id, u.name, w.safe_lat, w.safe_lng, w.safe_radius
  FROM wards w
  JOIN users u ON w.user_id = u.id
  WHERE w.user_id = ?
`;


  db.get(sql, [userId], (err, ward) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
if (!ward) {
  console.log(`⛔ wards 테이블에 user_id=${userId}인 노약자 정보 없음`);
  return res.status(404).json({ error: '노약자 정보 없음' });
}

    // ✅ ward_status 자동 생성 확인
    db.get(`SELECT * FROM ward_status WHERE ward_id = ?`, [ward.ward_id], (err, status) => {
      if (err) return res.status(500).json({ error: '상태 조회 실패' });

      if (!status) {
        db.run(`INSERT INTO ward_status (ward_id) VALUES (?)`, [ward.ward_id], (err) => {
          if (err) return res.status(500).json({ error: '상태 초기화 실패' });
          console.log(`[자동등록] ward_status 생성됨 (ward_id: ${ward.ward_id})`);
        });
        // 자동 생성 후 처음 위치 전송이므로 알림 안 보냄
        db.run(`INSERT INTO locations (ward_id, lat, lng) VALUES (?, ?, ?)`,
          [ward.ward_id, lat, lng]);
        return res.json({ success: true, message: '상태 초기화 완료, 위치 저장됨' });
      }

      // 📍 상태가 있는 경우 거리 계산
      const distance = getDistance(lat, lng, ward.safe_lat, ward.safe_lng);
      const safeRadius = ward.safe_radius || 100;
      const isOutside = status.is_outside === 1;
      const alertInterval = (status.alert_interval || 30) * 1000;

      // 위치 저장
      db.run(`INSERT INTO locations (ward_id, lat, lng) VALUES (?, ?, ?)`,
        [ward.ward_id, lat, lng]);

      // 상태 판단 및 알림
      if (distance > safeRadius && !isOutside) {
        notifyGuardian(`${ward.name}님이 외출했습니다 (${new Date(now).toLocaleTimeString()})`);
        db.run(`UPDATE ward_status SET is_outside = 1, last_alert_time = ? WHERE ward_id = ?`,
          [now, ward.ward_id]);
      } else if (distance > safeRadius && isOutside && now - status.last_alert_time > alertInterval) {
        notifyGuardian(`${ward.name}님이 외출 중입니다 (${new Date(now).toLocaleTimeString()})`);
        db.run(`UPDATE ward_status SET last_alert_time = ? WHERE ward_id = ?`,
          [now, ward.ward_id]);
      } else if (distance <= safeRadius && isOutside) {
        notifyGuardian(`${ward.name}님이 귀가했습니다 (${new Date(now).toLocaleTimeString()})`);
        db.run(`UPDATE ward_status SET is_outside = 0, last_alert_time = ? WHERE ward_id = ?`,
          [now, ward.ward_id]);
      }

      res.json({ success: true, distance: distance.toFixed(2) });
    });
  });
});

module.exports = router;
