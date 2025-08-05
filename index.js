// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const wardLocationRouter = require('./routes/wardLocation');
const missingWardsRouter = require('./routes/missingWard');
const auth = require('./middlewares/auth');


const app = express();

app.use(cors());                   // ← 모든 도메인 허용 (개발용)
app.use(express.json());           // ← JSON 바디 파싱
app.use(bodyParser.json());






const JWT_SECRET = 'my_secret_key';
const PORT = process.env.PORT || 3000;




const authenticateToken = require('./middlewares/auth');
const server = http.createServer(app);           // http 서버
const io = new Server(server, { cors: { origin: '*' } });   // WebSocket 허용


// ✅ 1. 공통 회원가입 API (/signup)
// 1) 첫 화면용: 기본 회원가입 (/signup)
//    name, email, password 세 가지만 받아 users 테이블에 INSERT
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({
      error: '필수 필드(name, email, password)가 누락되었습니다.'
    });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const sql  = `
      INSERT INTO users (name, email, password)
      VALUES (?, ?, ?)
    `;
    db.run(sql, [name, email, hash], function(err) {
      if (err) {
        console.error('기본 회원가입 실패:', err);
        return res.status(500).json({ error: 'DB 오류', detail: err.message });
      }
      // 생성된 user_id를 반환
      res.status(201).json({
        success: true,
        user_id: this.lastID
      });
    });
  } catch (e) {
    console.error('서버 오류:', e);
    res.status(500).json({ error: '서버 오류', detail: e.message });
  }
});

// 2) 두 번째 화면용: 추가 정보 저장 (/extra/:user_id)
//    birthdate, phone, gender, role 네 가지 받아서 해당 user 레코드 UPDATE
app.post('/extra/:user_id', (req, res) => {
  const userId = Number(req.params.user_id);
  const { birthdate, phone, gender, role } = req.body;

  if (!birthdate || !phone || !gender || !role) {
    return res.status(400).json({
      error: 'birthdate, phone, gender, role이 모두 필요합니다.'
    });
  }

  const sql = `
    UPDATE users
       SET birthdate = ?,
           phone     = ?,
           gender    = ?,
           role      = ?
     WHERE id = ?
  `;
  db.run(sql, [birthdate, phone, gender, role, userId], function(err) {
    if (err) {
      console.error('추가 정보 저장 실패:', err);
      return res.status(500).json({ error: 'DB 오류', detail: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '해당 user_id를 찾을 수 없습니다.' });
    }
    res.json({ success: true, message: '추가 정보 저장 완료' });
  });
});


// ✅ 2. 보호자 정보 추가 API (/signup/guardian/:user_id)
app.post('/signup/guardian/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { address, relation } = req.body;

  // 1. 먼저 users 테이블에서 해당 user_id가 존재하는지 확인
  db.get(`SELECT * FROM users WHERE id = ?`, [user_id], (err, user) => {
    if (err) return res.status(500).json({ error: '유저 확인 실패', detail: err.message });
    if (!user) return res.status(400).json({ error: '존재하지 않는 사용자입니다' });

    // 2. guardians 테이블에서 중복 등록 확인
    db.get(`SELECT * FROM guardians WHERE user_id = ?`, [user_id], (err, existing) => {
      if (err) return res.status(500).json({ error: '중복 확인 실패', detail: err.message });
      if (existing) return res.status(400).json({ error: '이미 등록된 보호자입니다' });

      // 3. 중복 없고 유저 존재하면 삽입
      db.run(
        `INSERT INTO guardians (user_id, address, relation)
         VALUES (?, ?, ?)`,
        [user_id, address, relation],
        function (err) {
          if (err) return res.status(500).json({ error: '보호자 정보 저장 실패', detail: err.message });
          res.json({ success: true, message: '보호자 정보 등록 완료' });
        }
      );
    });
  });
});


// ✅ 3. 노약자 정보 추가 API (/signup/ward/:user_id)
// 노약자 회원가입
// 노약자 회원가입
app.post('/signup/ward/:user_id', (req, res) => {
  console.log('▶ signupWard body:', req.body);
  const userId = Number(req.params.user_id);
  const {
    height,           // Float, e.g. 170.5
    weight,           // Float, e.g. 65.2
    medical_status,   // String, e.g. '고혈압, 당뇨'
    home_address      // String, e.g. '서울시 강남구 ...'
  } = req.body;

  // 1) 필수 값 체크
  if (![height, weight, medical_status, home_address].every(v => v !== undefined && v !== "")) {
    return res.status(400).json({ error: '모든 정보를 입력해야 합니다.' });
  }

  // 2) 공통 회원 확인
  db.get(
    `SELECT * FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'DB 에러', detail: err.message });
      if (!user) return res.status(400).json({ error: '공통 회원가입이 선행되어야 합니다.' });
      if (user.role !== 'ward') return res.status(400).json({ error: '해당 계정은 노약자 전용이 아닙니다.' });

      // 3) 이미 등록된 노약자인지 확인
      db.get(
        `SELECT * FROM wards WHERE user_id = ?`,
        [userId],
        (err, ward) => {
          if (err) return res.status(500).json({ error: 'DB 에러', detail: err.message });
          if (ward) return res.status(400).json({ error: '이미 등록된 노약자입니다.' });

          // 4) 등록 실행
          const sql = `
            INSERT INTO wards
              (user_id, height, weight, medical_status, home_address)
            VALUES (?, ?, ?, ?, ?)
          `;
          db.run(
            sql,
            [userId, height, weight, medical_status, home_address],
            function (err) {
              if (err) {
                console.error('INSERT ERROR:', err);
                return res.status(500).json({ error: '노약자 등록 실패', detail: err.message });
              }
              res.json({
                success: true,
                message: '노약자 정보 등록 완료',
                ward_id: this.lastID
              });
            }
          );
        }
      );
    }
  );
});



// ✅ 4. 로그인 + JWT 토큰 발급 API (/login)
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: '서버 오류', detail: err.message });
    if (!user) return res.status(401).json({ error: '존재하지 않는 이메일입니다.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });

    const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: '로그인 성공',
      token,
      user_id: user.id,
      role: user.role,
      name: user.name
    });
  });
});

app.get('/user/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: '로그인한 사용자 정보',
    user: req.user  // 여기에는 { user_id, role } 이 들어있음
  });
});

// 📡 GPS 위치 기능 연결
require('./location')(app, io);

// 라우터 연결
// /ward/* 요청은 routes/wardLocation.js 로 전달
app.use('/ward', auth, wardLocationRouter);

// 보호자 알림 출력 함수 (현재는 콘솔 출력만)
function notifyGuardian(message) {
  console.log(`[알림] ${message}`);
}

// ✅ 실종 감지 함수 추가
function checkNoMovement() {
  const now = Date.now();

  const sql = `
    SELECT ws.ward_id, ws.last_moved_at, ws.last_lat, ws.last_lng,
           u.name, w.user_id
    FROM ward_status ws
    JOIN wards w ON ws.ward_id = w.id
    JOIN users u ON w.user_id = u.id
    WHERE ws.is_outside = 1
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return console.error('🚫 감지 실패:', err.message);

    rows.forEach(row => {
      const timeDiff = now - row.last_moved_at;
      const overOneHour = timeDiff > 3600 * 1000;  // 1시간(3600초) 이상 정지 여부


      if (!overOneHour) return;

      // 이미 실종자로 등록된 경우 제외
      const checkMissingSql = `
        SELECT 1 FROM missing_wards WHERE ward_id = ? AND status = 'active'
      `;
      db.get(checkMissingSql, [row.ward_id], (err, found) => {
        if (err) return console.error('🚫 missing_wards 조회 실패:', err.message);
        if (found) return; // 이미 등록됨

        // 실종자 등록
        const insertSql = `
          INSERT INTO missing_wards (
            ward_id, detected_at, last_lat, last_lng, status, notes, updated_at
          ) VALUES (
            ?, DATETIME('now'), ?, ?, 'active', ?, DATETIME('now')
          )
        `;
        const note = `${row.name}님이 외부에서 1시간 이상 움직이지 않았습니다`;
        db.run(insertSql, [row.ward_id, row.last_lat, row.last_lng, note], (err) => {
          if (err) return console.error('🚫 실종 등록 실패:', err.message);

          // 보호자 알림 (콘솔 출력)
          notifyGuardian(`🚨 [실종 감지] ${note}`);
        });
      });
    });
  });
}

// ✅ 주기적으로 실행 (5분마다)
setInterval(checkNoMovement, 5 * 60 * 1000);    // 5분(300초)마다 감지 체크 주기

// 실종자 조회
app.use('/missing_wards', missingWardsRouter);

// 서버 시작 후 기존 외출 중인 사용자들의 타이머를 설정
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
