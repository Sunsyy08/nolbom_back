const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middlewares/auth');

// 거리 계산 (Haversine 공식)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 지구 반지름(m)
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 보호자 알림 (터미널 로그)
function notifyGuardian(message) {
  console.log('[알림]', message);
}

// 1️⃣ 집 위치 등록
router.post('/home', auth, (req, res) => {
  const { lat, lng, radius } = req.body;
  const userId = req.user.user_id;
  if (lat == null || lng == null) {
    return res.status(400).json({ error: '위도와 경도가 필요합니다' });
  }

  const safeRadius = radius != null ? radius : 100;
  db.get(
    `SELECT id FROM wards WHERE user_id = ?`,
    [userId],
    (err, ward) => {
      if (err) return res.status(500).json({ error: 'DB 오류' });
      if (!ward) return res.status(404).json({ error: '노약자 정보 없음' });

      db.run(
        `UPDATE wards SET safe_lat=?, safe_lng=?, safe_radius=? WHERE id=?`,
        [lat, lng, safeRadius, ward.id],
        err => {
          if (err) return res.status(500).json({ error: '집 등록 실패' });
          return res.json({ success: true, message: '집 위치 등록 완료' });
        }
      );
    }
  );
});

// 2️⃣ 위치 업데이트 및 알림 처리
router.post('/location', auth, (req, res) => {
  const { lat, lng } = req.body;
  const userId = req.user.user_id;
  const now = Date.now();
  if (lat == null || lng == null) {
    return res.status(400).json({ error: '위도와 경도가 필요합니다' });
  }

  // 1) 노약자 + 집 정보 조회
  const sqlWard = `
    SELECT w.id AS ward_id, u.name, w.safe_lat, w.safe_lng, w.safe_radius
    FROM wards w
    JOIN users u ON w.user_id = u.id
    WHERE w.user_id = ?
  `;
  db.get(sqlWard, [userId], (err, ward) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    if (!ward) return res.status(404).json({ error: '노약자 정보 없음' });

    // 2) 기존 상태 조회
    db.get(`SELECT * FROM ward_status WHERE ward_id = ?`, [ward.ward_id], (err, status) => {
      if (err) return res.status(500).json({ error: '상태 조회 실패' });

      // 2-1) 최초 호출: 레코드 없으면 INSERT + '집입니다(출발 전)' 알림
      if (!status) {
        db.run(
          `INSERT INTO ward_status (ward_id, is_outside, alert_interval, last_alert_time)
           VALUES (?, 0, 10, ?)`,
          [ward.ward_id, now],
          err => {
            if (err) return res.status(500).json({ error: '상태 초기화 실패' });
            // 위치 저장
            db.run(`INSERT INTO locations (ward_id, lat, lng) VALUES (?, ?, ?)`, [ward.ward_id, lat, lng]);
            // 최초 집 알림
            notifyGuardian(`${ward.name}님은 집입니다 (출발 전)`);
            return res.json({ success: true, message: '초기 상태(home) 저장됨' });
          }
        );
        return;
      }

      // 3) 거리 계산 + 위치 저장
      const distance = getDistance(lat, lng, ward.safe_lat, ward.safe_lng);
      const safeRadius = ward.safe_radius != null ? ward.safe_radius : 100;
      const isOutside = status.is_outside === 1;
      db.run(`INSERT INTO locations (ward_id, lat, lng) VALUES (?, ?, ?)`, [ward.ward_id, lat, lng]);

      // 4) 상태 전환 및 알림
      if (distance > safeRadius && !isOutside) {
        // 집 → 외출
        notifyGuardian(`${ward.name}님이 외출했습니다 (${new Date(now).toLocaleTimeString()})`);
        db.run(`UPDATE ward_status SET is_outside=1, last_alert_time=? WHERE ward_id=?`, [now, ward.ward_id]);
      }
      else if (distance > safeRadius && isOutside && now - status.last_alert_time >= (status.alert_interval||10)*1000) {
        // 외출 중 반복 (별도 스케줄러 없이 호출 시)
        notifyGuardian(`${ward.name}님이 외출 중입니다 (${new Date(now).toLocaleTimeString()})`);
        db.run(`UPDATE ward_status SET last_alert_time=? WHERE ward_id=?`, [now, ward.ward_id]);
      }
      else if (distance <= safeRadius && isOutside) {
        // 귀가 → '집입니다(귀가 후)'
        notifyGuardian(`${ward.name}님은 집입니다 (귀가 후)`);
        db.run(`UPDATE ward_status SET is_outside=0, last_alert_time=? WHERE ward_id=?`, [now, ward.ward_id]);
      }

      // 응답
      return res.json({ success: true, distance: distance.toFixed(2), isOutside });
    });
  });
});

module.exports = router;
