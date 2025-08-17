// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const multer       = require('multer');
const storage      = multer.memoryStorage();
const upload = multer({ storage: multer.memoryStorage() });

const FormDataLib  = require('form-data');
const axios        = require('axios');    


const db = require('./db');
const wardLocationRouter = require('./routes/wardLocation');
const missingWardsRouter = require('./routes/missingWard');
const auth = require('./middlewares/auth');
const emergencyRoutes = require('./routes/emergency');
const missingRoutes = require('./routes/missing');
const reportsRoutes = require('./routes/reports');


const app = express();

app.use(cors());                   // ← 모든 도메인 허용 (개발용)
app.use(express.json());           // ← JSON 바디 파싱
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 미들웨어 설정
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:8000'], // Python FastAPI와 프론트엔드 허용
  credentials: true
}));

app.use(express.json({ limit: '10mb' })); // JSON 파싱 (이미지 데이터 고려)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
      
      // 🆕 회원가입 성공 시 바로 JWT 토큰 발급
      const token = jwt.sign(
        { user_id: this.lastID, role: 'user' }, 
        JWT_SECRET, 
        { expiresIn: '365d' }
      );
      
      // 생성된 user_id와 토큰을 함께 반환
      res.status(201).json({
        success: true,
        user_id: this.lastID,
        token: token,           // 🆕 토큰 추가
        name: name,             // 🆕 이름 추가
        email: email,           // 🆕 이메일 추가
        message: '회원가입 성공'
      });
    });
  } catch (e) {
    console.error('서버 오류:', e);
    res.status(500).json({ error: '서버 오류', detail: e.message });
  }
});


// 2) 두 번째 화면용: 추가 정보 저장 (/extra/:user_id)
//    birthdate, phone, gender, role 네 가지 받아서 해당 user 레코드 UPDATE
// 2) 두 번째 화면용: 추가 정보 저장 (/extra/:user_id)
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
    
    // 🆕 role 업데이트 후 새로운 토큰 발급
    const updatedToken = jwt.sign(
      { user_id: userId, role: role }, 
      JWT_SECRET, 
      { expiresIn: '30d' }
    );
    
    res.json({ 
      success: true, 
      message: '추가 정보 저장 완료',
      token: updatedToken,  // 🆕 업데이트된 토큰
      role: role            // 🆕 role 정보
    });
  });
});


// ✅ 2. 보호자 정보 추가 API (/signup/guardian/:user_id)
// ✅ 2. 보호자 정보 추가 API (/signup/guardian/:user_id)
app.post('/signup/guardian/:user_id', upload.fields([
  { name: 'profile_image_file', maxCount: 1 },
]), (req, res) => {
  const { user_id } = req.params;
  const { wardEmail, address, relation } = req.body;

  if (!wardEmail) {
    return res.status(400).json({ error: 'wardEmail이 필요합니다.' });
  }

  db.get(`SELECT * FROM users WHERE id = ?`, [user_id], (err, user) => {
    if (err) return res.status(500).json({ error: '유저 확인 실패', detail: err.message });
    if (!user) return res.status(400).json({ error: '존재하지 않는 사용자입니다' });

    db.get(`SELECT id FROM users WHERE email = ? AND role = 'ward'`, [wardEmail], (err, ward) => {
      if (err) return res.status(500).json({ error: '노약자 조회 실패', detail: err.message });
      if (!ward) return res.status(404).json({ error: '등록된 노약자를 찾을 수 없습니다.' });

      const ward_id = ward.id;

      db.get(`SELECT * FROM guardians WHERE user_id = ? AND ward_id = ?`, [user_id, ward_id], (err, existing) => {
        if (err) return res.status(500).json({ error: '중복 확인 실패', detail: err.message });
        if (existing) return res.status(400).json({ error: '이미 등록된 보호자-노약자 관계입니다' });

        db.run(`INSERT INTO guardians (user_id, ward_id, address, relation) VALUES (?, ?, ?, ?)`,
          [user_id, ward_id, address, relation],
          function (err) {
            if (err) return res.status(500).json({ error: '보호자 정보 저장 실패', detail: err.message });
            
            // 🆕 보호자 등록 완료 시 새 토큰 발급
            const guardianToken = jwt.sign(
              { user_id: user_id, role: 'guardian' }, 
              JWT_SECRET, 
              { expiresIn: '30d' }
            );
            
            res.status(201).json({ 
              success: true, 
              message: '보호자 정보 등록 완료', 
              guardianId: this.lastID,
              token: guardianToken,  // 🆕 토큰 추가
              address: address       // 🆕 주소 정보 추가
            });
          }
        );
      });
    });
  });
});




// ✅ 3. 노약자 정보 추가 API (/signup/ward/:user_id)
// 노약자 회원가입
// 노약자 회원가입
app.post('/signup/ward/:user_id', upload.single('profile_image_file'), (req, res) => {
  console.log('▶ signupWard body:', req.body);
  console.log('▶ signupWard file:', req.file);

  const userId = Number(req.params.user_id);
  const {
    height,
    weight,
    medical_status,
    home_address,
    safe_lat,
    safe_lng,
    safe_radius
  } = req.body;

  const imageBuffer = req.file?.buffer;
  if (!imageBuffer) {
    return res.status(400).json({ error: '프로필 이미지를 첨부해야 합니다.' });
  }

  if (![height, weight, medical_status, home_address, safe_lat, safe_lng, safe_radius]
      .every(v => v !== undefined && v !== "")) {
    return res.status(400).json({ error: '모든 정보를 입력해야 합니다.' });
  }

  db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'DB 에러', detail: err.message });
    if (!user) return res.status(400).json({ error: '공통 회원가입이 선행되어야 합니다.' });
    if (user.role !== 'ward') return res.status(400).json({ error: '해당 계정은 노약자 전용이 아닙니다.' });

    db.get(`SELECT * FROM wards WHERE user_id = ?`, [userId], (err, ward) => {
      if (err) return res.status(500).json({ error: 'DB 에러', detail: err.message });
      if (ward) return res.status(400).json({ error: '이미 등록된 노약자입니다.' });

      const sql = `
        INSERT INTO wards
          (user_id, height, weight, medical_status,
           home_address, profile_image_data,
           safe_lat, safe_lng, safe_radius)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(sql, [userId, height, weight, medical_status, home_address, imageBuffer, safe_lat, safe_lng, safe_radius],
        function (err) {
          if (err) {
            console.error('INSERT ERROR:', err);
            return res.status(500).json({ error: '노약자 등록 실패', detail: err.message });
          }
          
          // 🆕 노약자 등록 완료 시 새 토큰 발급 (role='ward'로)
          const wardToken = jwt.sign(
            { user_id: userId, role: 'ward' }, 
            JWT_SECRET, 
            { expiresIn: '30d' }
          );
          
          // 🆕 프로필 이미지를 Base64로 변환해서 반환
          const profileImageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
          
          res.json({
            success: true,
            message: '노약자 정보 등록 완료',
            ward_id: this.lastID,
            token: wardToken,              // 🆕 토큰 추가
            user_id: userId,
            name: user.name,               // 🆕 이름 추가
            home_address: home_address,    // 🆕 주소 추가
            profile_image: profileImageBase64  // 🆕 프로필 이미지 추가
          });
        }
      );
    });
  });
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

app.post('/capture', upload.single('file'), async (req, res) => {
  console.log('axios:', axios);
  console.log('>>> /capture req.file:', req.file);

  if (!req.file) {
    return res.status(400).json({ success:false, message:'업로드된 파일이 없습니다.' });
  }

  // form-data 패키지로 생성
  const form = new FormDataLib();
  form.append('file', req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype
  });

  try {
    const apiRes = await axios.post(
      'http://127.0.0.1:5500/capture',
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    console.log('>>> FastAPI 응답:', apiRes.data);
    return res.status(apiRes.status).json(apiRes.data);

  } catch (e) {
    console.error('>>> FastAPI 호출 중 오류:', e.response?.status, e.response?.data || e.message);
    return res.status(500).json({
      success: false,
      message: '프록시 오류',
      detail: e.response?.data || e.message
    });
  }
});

// 기존 코드에 추가할 API들

// ✅ 사용자 프로필 정보 조회 API (홈 화면용)
app.get('/user/profile', authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  
  // users 테이블에서 기본 정보 조회
  db.get(`SELECT name, email, role FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        error: 'DB 오류', 
        detail: err.message 
      });
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: '사용자를 찾을 수 없습니다.' 
      });
    }

    // 노약자인 경우 추가 정보 조회
    if (user.role === 'ward') {
      const wardSql = `
        SELECT home_address, profile_image_data 
        FROM wards 
        WHERE user_id = ?
      `;
      
      db.get(wardSql, [userId], (err, wardInfo) => {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            error: 'DB 오류', 
            detail: err.message 
          });
        }

        // 프로필 이미지를 Base64로 인코딩
        let profileImageBase64 = null;
        if (wardInfo && wardInfo.profile_image_data) {
          profileImageBase64 = `data:image/jpeg;base64,${wardInfo.profile_image_data.toString('base64')}`;
        }

        res.json({
          success: true,
          profile: {
            name: user.name,
            email: user.email,
            role: user.role,
            home_address: wardInfo?.home_address || null,
            profile_image: profileImageBase64
          }
        });
      });
    } 
    // 보호자인 경우
    else if (user.role === 'guardian') {
      const guardianSql = `
        SELECT address 
        FROM guardians 
        WHERE user_id = ? 
        LIMIT 1
      `;
      
      db.get(guardianSql, [userId], (err, guardianInfo) => {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            error: 'DB 오류', 
            detail: err.message 
          });
        }

        res.json({
          success: true,
          profile: {
            name: user.name,
            email: user.email,
            role: user.role,
            home_address: guardianInfo?.address || null,
            profile_image: null // 보호자는 프로필 이미지가 없음
          }
        });
      });
    }
    // 기본 사용자인 경우
    else {
      res.json({
        success: true,
        profile: {
          name: user.name,
          email: user.email,
          role: user.role,
          home_address: null,
          profile_image: null
        }
      });
    }
  });
});

// ✅ 프로필 이미지만 별도로 조회하는 API (최적화용)
app.get('/user/profile-image', authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  
  // 노약자의 프로필 이미지만 조회
  const sql = `
    SELECT profile_image_data 
    FROM wards 
    WHERE user_id = ?
  `;
  
  db.get(sql, [userId], (err, result) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        error: 'DB 오류', 
        detail: err.message 
      });
    }

    if (!result || !result.profile_image_data) {
      return res.status(404).json({ 
        success: false, 
        error: '프로필 이미지를 찾을 수 없습니다.' 
      });
    }

    // 이미지를 직접 반환 (바이너리)
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': result.profile_image_data.length
    });
    res.send(result.profile_image_data);
  });
});

// 기존 코드에 추가할 프로필 화면용 API (조회만)

// ✅ 프로필 정보 조회 API (프로필 화면용)
app.get('/user/full-profile', authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  
  // users 테이블에서 기본 정보 조회
  const userSql = `
    SELECT id, name, email, role, birthdate, phone, gender 
    FROM users 
    WHERE id = ?
  `;
  
  db.get(userSql, [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        error: 'DB 오류', 
        detail: err.message 
      });
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: '사용자를 찾을 수 없습니다.' 
      });
    }

    // 생년월일 포맷팅 함수
    const formatBirthDate = (birthdate) => {
      if (!birthdate) return null;
      const date = new Date(birthdate);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    // 사용자 타입에 따른 한국어 변환
    const getUserTypeKorean = (role) => {
      switch(role) {
        case 'ward': return '노약자';
        case 'guardian': return '보호자';
        default: return '사용자';
      }
    };

    // 노약자인 경우 추가 정보 조회
    if (user.role === 'ward') {
      const wardSql = `
        SELECT home_address, profile_image_data
        FROM wards 
        WHERE user_id = ?
      `;
      
      db.get(wardSql, [userId], (err, wardInfo) => {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            error: 'DB 오류', 
            detail: err.message 
          });
        }

        // 프로필 이미지를 Base64로 인코딩
        let profileImageBase64 = null;
        if (wardInfo && wardInfo.profile_image_data) {
          profileImageBase64 = `data:image/jpeg;base64,${wardInfo.profile_image_data.toString('base64')}`;
        }

        res.json({
          success: true,
          profile: {
            name: user.name,
            email: user.email,
            userType: getUserTypeKorean(user.role),
            birthDate: formatBirthDate(user.birthdate),
            phoneNumber: user.phone || null,
            address: wardInfo?.home_address || null,
            profileImage: profileImageBase64
          }
        });
      });
    } 
    // 보호자인 경우
    else if (user.role === 'guardian') {
      const guardianSql = `
        SELECT address 
        FROM guardians 
        WHERE user_id = ? 
        LIMIT 1
      `;
      
      db.get(guardianSql, [userId], (err, guardianInfo) => {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            error: 'DB 오류', 
            detail: err.message 
          });
        }

        res.json({
          success: true,
          profile: {
            name: user.name,
            email: user.email,
            userType: getUserTypeKorean(user.role),
            birthDate: formatBirthDate(user.birthdate),
            phoneNumber: user.phone || null,
            address: guardianInfo?.address || null,
            profileImage: null // 보호자는 프로필 이미지가 없음
          }
        });
      });
    }
    // 기본 사용자인 경우
    else {
      res.json({
        success: true,
        profile: {
          name: user.name,
          email: user.email,
          userType: getUserTypeKorean(user.role),
          birthDate: formatBirthDate(user.birthdate),
          phoneNumber: user.phone || null,
          address: null,
          profileImage: null
        }
      });
    }
  });
});



// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`📡 ${new Date().toLocaleString()} - ${req.method} ${req.path}`);
  next();
});
// API 라우트 연결
// 응급 신고 라우터 연결
app.use('/api/emergency', emergencyRoutes);
app.use('/api/missing', missingRoutes);
app.use('/api/reports', reportsRoutes);

// 헬스체크 엔드포인트
app.get('/api/health', (req, res) => {
  res.json({
      success: true,
      message: '놀봄 Node.js API 서버 정상 동작',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      features: [
          '실종자 목록 관리',
          '신고 이력 저장',
          'Python FastAPI 연동',
          'Android Kotlin Compose 지원'
      ]
  });
});

// 🔧 루트 엔드포인트도 올바른 경로로 수정
app.get('/', (req, res) => {
  res.json({
      message: '🚀 놀봄 API 서버에 오신 것을 환영합니다!',
      version: '1.0.0',
      endpoints: {
          health: '/api/health',
          missing: '/api/missing',          // 수정됨
          reports: '/api/reports',
          emergency: '/api/emergency'       // 추가됨
      },
      docs: '각 엔드포인트에 GET 요청을 보내 API 문서를 확인하세요'
  });
});

// 대시보드 통계 API - 🔧 수정된 버전
app.get('/api/dashboard', async (req, res) => {
  try {
      // 🔧 올바른 테이블명으로 수정
      const queries = [
          'SELECT COUNT(*) as count FROM missing_wards WHERE status = "MISSING"',
          'SELECT COUNT(*) as count FROM missing_wards WHERE status = "FOUND"', 
          'SELECT COUNT(*) as count FROM emergency_reports WHERE DATE(report_time) = DATE("now")',
          'SELECT COUNT(*) as count FROM emergency_reports WHERE detected_keyword IS NOT NULL'
      ];
      
      const results = await Promise.all(
          queries.map(query => new Promise((resolve, reject) => {
              db.get(query, [], (err, row) => {
                  if (err) reject(err);
                  else resolve(row.count || 0);
              });
          }))
      );
      
      // 🔧 올바른 테이블명으로 수정된 최근 활동 조회
      const recentActivityQuery = `
          SELECT 
              'missing' as type,
              u.name as title,
              mw.detected_at as created_at,
              '실종 신고' as description
          FROM missing_wards mw
          JOIN wards w ON mw.ward_id = w.id
          JOIN users u ON w.user_id = u.id
          WHERE DATE(mw.detected_at) >= DATE('now', '-7 days')
          UNION ALL
          SELECT 
              'report' as type,
              SUBSTR(er.transcript, 1, 50) || '...' as title,
              er.report_time as created_at,
              CASE 
                  WHEN er.detected_keyword IS NOT NULL THEN '응급 신고'
                  ELSE '일반 신고'
              END as description
          FROM emergency_reports er
          WHERE DATE(er.report_time) >= DATE('now', '-7 days')
          ORDER BY created_at DESC
          LIMIT 10
      `;
      
      const recentActivity = await new Promise((resolve, reject) => {
          db.all(recentActivityQuery, [], (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
          });
      });
      
      res.json({
          success: true,
          stats: {
              missing_count: results[0],
              found_count: results[1], 
              today_reports: results[2],
              keyword_reports: results[3]
          },
          recent_activity: recentActivity
      });
      
  } catch (error) {
      console.error('❌ 대시보드 통계 조회 실패:', error);
      res.status(500).json({
          success: false,
          error: '대시보드 통계 조회 실패',
          detail: error.message
      });
  }
});


// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error('❌ 서버 에러:', err);
  res.status(500).json({
      success: false,
      error: '서버 내부 오류가 발생했습니다',
      timestamp: new Date().toISOString()
  });
});

// 서버 시작 후 기존 외출 중인 사용자들의 타이머를 설정
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  // 서버 시작 부분에 로그 추가 (기존 console.log 아래에)
console.log('📋 응급 신고 API: /api/emergency');
console.log('  - 신고 저장: POST /api/emergency/report');
console.log('  - 신고 목록: GET /api/emergency/reports');
console.log('  - 통계 조회: GET /api/emergency/stats/dashboard');
console.log('  - 최근 신고: GET /api/emergency/recent');
});
