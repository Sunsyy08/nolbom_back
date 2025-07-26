// location.js
const express = require('express');
const db = require('./db'); // 기존 회원가입에서 쓰던 db와 동일


const userLocations = {};

module.exports = function(app, io) {
  const router = express.Router();

  // 위치 저장
  router.post('/', (req, res) => {
  const { user_id, lat, lng } = req.body;

  if (!user_id || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'user_id, lat, lng 필수' });
  }

  const data = {
    lat,
    lng,
    updatedAt: new Date().toISOString()
  };

  // ✅ 여기가 핵심: 노약자 등록 여부 확인
  db.get(
    `SELECT * FROM users WHERE id = ? AND role = 'ward'`,
    [user_id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'DB 오류', detail: err.message });
      }

      if (!user) {
        return res.status(403).json({ error: '등록되지 않은 노약자입니다.' });
      }

      // ⬇ 등록된 노약자일 경우에만 처리
      userLocations[user_id] = data;

      db.run(
        `INSERT INTO locations (user_id, lat, lng, timestamp)
         VALUES (?, ?, ?, ?)`,
        [user_id, lat, lng, data.updatedAt],
        (err) => {
          if (err) console.error('위치 저장 실패:', err.message);
        }
      );

      io.emit('location_update', { user_id, ...data });

      res.json({ status: 'ok', data });
    }
  );
});

  // 위치 조회
  router.get('/:user_id', (req, res) => {
    const data = userLocations[req.params.user_id];
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  });

  // 전체 위치 조회
  router.get('/', (req, res) => {
    res.json(userLocations);
  });

  app.use('/location', router);

  // WebSocket 로그
  io.on('connection', (socket) => {
    console.log('🟢 WebSocket 연결됨');
    socket.on('disconnect', () => {
      console.log('🔴 연결 해제됨');
    });
  });
};
