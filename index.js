// index.js
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
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

// 서버 실행
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});