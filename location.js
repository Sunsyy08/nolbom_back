// location.js - 수정된 버전
const express = require('express');
const db = require('./db');

// 사용자 위치 및 연결 상태 관리
const userLocations = new Map();
const connectedUsers = new Map(); // socket.id -> user_info

module.exports = function(app, io) {
  const router = express.Router();

  // ===== REST API 부분 =====
  
  // 위치 저장 (기존 REST API 유지)
  router.post('/', (req, res) => {
    const { user_id, lat, lng } = req.body;

    if (!user_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'user_id, lat, lng 필수' });
    }

    const data = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      updatedAt: new Date().toISOString()
    };

    // 노약자 등록 여부 확인 + ward_id 조회
    db.get(
      `SELECT u.*, w.id as ward_id FROM users u
       LEFT JOIN wards w ON u.id = w.user_id  
       WHERE u.id = ? AND u.role = 'ward'`,
      [user_id],
      (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'DB 오류', detail: err.message });
        }

        if (!user || !user.ward_id) {
          return res.status(403).json({ error: '등록되지 않은 노약자입니다.' });
        }

        // 위치 데이터 저장
        const locationData = {
          user_id,
          userName: user.name || `사용자${user_id}`,
          lat: data.lat,
          lng: data.lng,
          updatedAt: data.updatedAt,
          isOnline: true
        };

        userLocations.set(user_id, locationData);

        // DB에 저장 - ward_id 사용
        db.run(
          `INSERT INTO locations (ward_id, lat, lng, timestamp)
           VALUES (?, ?, ?, ?)`,
          [user.ward_id, data.lat, data.lng, data.updatedAt],
          (err) => {
            if (err) console.error('위치 저장 실패:', err.message);
          }
        );

        // 모든 연결된 클라이언트에게 위치 업데이트 브로드캐스트
        io.emit('location_update', {
          type: 'location',
          userId: user_id,
          userName: locationData.userName,
          latitude: data.lat,
          longitude: data.lng,
          timestamp: new Date().getTime()
        });

        res.json({ status: 'ok', data: locationData });
      }
    );
  });

  // 특정 사용자 위치 조회
  router.get('/:user_id', (req, res) => {
    const data = userLocations.get(req.params.user_id);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  });

  // 전체 온라인 사용자 위치 조회
  router.get('/', (req, res) => {
    const onlineUsers = Array.from(userLocations.values())
      .filter(user => user.isOnline)
      .map(user => ({
        userId: user.user_id,
        userName: user.userName,
        latitude: user.lat,
        longitude: user.lng,
        timestamp: new Date(user.updatedAt).getTime()
      }));
    
    res.json({
      type: 'users',
      data: onlineUsers,
      total: onlineUsers.length
    });
  });

  app.use('/location', router);

  // ===== WebSocket 부분 =====
  
  io.on('connection', (socket) => {
    console.log('🟢 WebSocket 연결됨:', socket.id);

    // 사용자 접속 처리
    socket.on('join', (data) => {
      try {
        const { userId, userName } = data;
        
        if (!userId) {
          socket.emit('error', { message: 'userId가 필요합니다' });
          return;
        }

        // 사용자 연결 정보 저장
        connectedUsers.set(socket.id, {
          userId,
          userName: userName || `사용자${userId}`,
          socketId: socket.id,
          joinedAt: new Date().toISOString()
        });

        console.log(`👤 사용자 접속: ${userName} (${userId})`);

        // 해당 사용자가 이미 위치 정보가 있다면 온라인 상태로 변경
        if (userLocations.has(userId)) {
          const userLocation = userLocations.get(userId);
          userLocation.isOnline = true;
          userLocation.userName = userName || userLocation.userName;
          userLocations.set(userId, userLocation);
        }

        // 새 사용자에게 현재 온라인 사용자 목록 전송
        const onlineUsers = Array.from(userLocations.values())
          .filter(user => user.isOnline && user.user_id !== userId) // 자신 제외
          .map(user => ({
            userId: user.user_id,
            userName: user.userName,
            latitude: user.lat,
            longitude: user.lng,
            timestamp: new Date(user.updatedAt).getTime()
          }));

        socket.emit('users_list', {
          type: 'users',
          data: onlineUsers
        });

        // 다른 사용자들에게 새 사용자 접속 알림
        socket.broadcast.emit('user_joined', {
          type: 'join',
          userId,
          userName: userName || `사용자${userId}`,
          timestamp: new Date().getTime()
        });

      } catch (error) {
        console.error('Join 처리 오류:', error);
        socket.emit('error', { message: '접속 처리 중 오류가 발생했습니다' });
      }
    });

    // 위치 업데이트 처리
    // 📍 79번째 줄 근처 - ward_id 조회 후 위치 저장 부분
socket.on('location', (data) => {
  try {
    const { userId, userName, latitude, longitude } = data;
    
    if (!userId || latitude === undefined || longitude === undefined) {
      socket.emit('error', { message: '필수 데이터가 누락되었습니다' });
      return;
    }

    // ward_id 조회 후 위치 저장
    db.get(
      `SELECT w.id as ward_id FROM wards w WHERE w.user_id = ?`,
      [userId],
      (err, ward) => {
        if (err || !ward) {
          console.error('Ward 조회 실패:', err?.message || 'Ward not found');
          return;
        }

        // 위치 데이터 업데이트
        const locationData = {
          user_id: userId,
          userName: userName || `사용자${userId}`,
          lat: parseFloat(latitude),
          lng: parseFloat(longitude),
          updatedAt: new Date().toISOString(),
          isOnline: true
        };

        userLocations.set(userId, locationData);

        // 🔧 수정: ward.ward_id → ward.id
        db.run(
          `INSERT INTO locations (ward_id, lat, lng, timestamp)
           VALUES (?, ?, ?, ?)`,
          [ward.id, locationData.lat, locationData.lng, locationData.updatedAt], // ← 여기 수정
          (err) => {
            if (err) console.error('위치 저장 실패:', err.message);
          }
        );

            // 다른 모든 클라이언트에게 위치 업데이트 브로드캐스트
            socket.broadcast.emit('location_update', {
              type: 'location',
              userId,
              userName: locationData.userName,
              latitude: locationData.lat,
              longitude: locationData.lng,
              timestamp: new Date().getTime()
            });

            console.log(`📍 위치 업데이트: ${userName} (${latitude}, ${longitude})`);
          }
        );

      } catch (error) {
        console.error('위치 업데이트 오류:', error);
        socket.emit('error', { message: '위치 업데이트 처리 중 오류가 발생했습니다' });
      }
    });

    // 사용자 목록 요청 처리
    socket.on('getUsers', () => {
      const onlineUsers = Array.from(userLocations.values())
        .filter(user => user.isOnline)
        .map(user => ({
          userId: user.user_id,
          userName: user.userName,
          latitude: user.lat,
          longitude: user.lng,
          timestamp: new Date(user.updatedAt).getTime()
        }));

      socket.emit('users_list', {
        type: 'users',
        data: onlineUsers
      });
    });

    // 연결 해제 처리
    socket.on('disconnect', () => {
      const userInfo = connectedUsers.get(socket.id);
      
      if (userInfo) {
        console.log(`🔴 사용자 해제: ${userInfo.userName} (${userInfo.userId})`);
        
        // 해당 사용자를 오프라인 상태로 변경
        if (userLocations.has(userInfo.userId)) {
          const userLocation = userLocations.get(userInfo.userId);
          userLocation.isOnline = false;
          userLocations.set(userInfo.userId, userLocation);
        }

        // 다른 사용자들에게 해제 알림
        socket.broadcast.emit('user_left', {
          type: 'leave',
          userId: userInfo.userId,
          userName: userInfo.userName,
          timestamp: new Date().getTime()
        });

        connectedUsers.delete(socket.id);
      }
      
      console.log('🔴 WebSocket 연결 해제됨:', socket.id);
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('WebSocket 오류:', error);
    });
  });

  // 주기적으로 오래된 오프라인 사용자 데이터 정리 (선택사항)
  setInterval(() => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    for (const [userId, userData] of userLocations.entries()) {
      const lastUpdate = new Date(userData.updatedAt);
      if (!userData.isOnline && lastUpdate < oneHourAgo) {
        userLocations.delete(userId);
        console.log(`🗑️ 오래된 사용자 데이터 삭제: ${userData.userName}`);
      }
    }
  }, 30 * 60 * 1000); // 30분마다 실행
};