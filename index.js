// index.js
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const authenticateToken = require('./middlewares/auth');

const JWT_SECRET = 'my_secret_key';

const app = express();
const http = require('http').createServer(app);           // http 서버
const { Server } = require('socket.io');                  // socket.io
const io = new Server(http, { cors: { origin: '*' } });   // WebSocket 허용


app.use(bodyParser.json());

// ✅ 1. 공통 회원가입 API (/signup)
app.post('/signup', async (req, res) => {
    const { email, password, name, birthdate, phone, role } = req.body;
  
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
  
      db.run(
        `INSERT INTO users (email, password, name, birthdate, phone, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [email, hashedPassword, name, birthdate, phone, role],
        function (err) {
          if (err) return res.status(500).json({ error: '회원가입 실패', detail: err.message });
  
          res.json({
            success: true,
            message: `${role === 'guardian' ? '보호자' : '노약자'} 회원가입 성공`,
            user_id: this.lastID
          });
        }
      );
    } catch (err) {
      res.status(500).json({ error: '서버 오류', detail: err.message });
    }
  });
  

// ✅ 2. 보호자 정보 추가 API (/signup/guardian/:user_id)
app.post('/signup/guardian/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { address, relation } = req.body;

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

// ✅ 3. 노약자 정보 추가 API (/signup/ward/:user_id)
app.post('/signup/ward/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { gender, medical_info, home_address, photo_url } = req.body;

  db.run(
    `INSERT INTO wards (user_id, gender, medical_info, home_address, photo_url)
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, gender, medical_info, home_address, photo_url],
    function (err) {
      if (err) return res.status(500).json({ error: '노약자 정보 저장 실패', detail: err.message });
      res.json({ success: true, message: '노약자 정보 등록 완료' });
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


// 서버 실행
const PORT = 3000;
http.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
