// final_debug.js - 라우트 연결 후 단계별 테스트
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// 기본 미들웨어
app.use(cors());
app.use(express.json());

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`📡 ${new Date().toLocaleString()} - ${req.method} ${req.path}`);
  next();
});

console.log('🔧 미들웨어 설정 완료');

// 라우터 연결
const wardLocationRouter = require('./routes/wardLocation');
const missingWardsRouter = require('./routes/missingWard');
const emergencyRoutes = require('./routes/emergency');
const missingRoutes = require('./routes/missing');
const reportsRoutes = require('./routes/reports');
const auth = require('./middlewares/auth');

console.log('🔧 라우터 연결 시작...');

require('./location')(app, io);
console.log('✅ location.js 연결 완료');

app.use('/ward', auth, wardLocationRouter);
console.log('✅ wardLocation 연결 완료');

app.use('/missing_wards', missingWardsRouter);
console.log('✅ missingWard 연결 완료');

app.use('/api/emergency', emergencyRoutes);
console.log('✅ emergency 연결 완료');

app.use('/api/missing', missingRoutes);
console.log('✅ missing 연결 완료');

app.use('/api/reports', reportsRoutes);
console.log('✅ reports 연결 완료');

// === 이제 기본 엔드포인트를 하나씩 추가해보기 ===

console.log('🔧 Step 1: 루트 엔드포인트 추가 시도...');
try {
  app.get('/', (req, res) => {
    res.json({
      message: '🚀 놀봄 API 서버에 오신 것을 환영합니다!',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        missing: '/api/missing',
        reports: '/api/reports',
        emergency: '/api/emergency'
      },
      docs: '각 엔드포인트에 GET 요청을 보내 API 문서를 확인하세요'
    });
  });
  console.log('✅ 루트 엔드포인트 추가 성공');
} catch (error) {
  console.error('❌ 루트 엔드포인트 추가 실패:', error.message);
  process.exit(1);
}

console.log('🔧 Step 2: 헬스체크 엔드포인트 추가 시도...');
try {
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      message: '놀봄 Node.js API 서버 정상 동작',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });
  console.log('✅ 헬스체크 엔드포인트 추가 성공');
} catch (error) {
  console.error('❌ 헬스체크 엔드포인트 추가 실패:', error.message);
  process.exit(1);
}

console.log('🔧 Step 3: 404 에러 핸들러 추가 시도...');
try {
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: '요청한 API 엔드포인트를 찾을 수 없습니다',
      path: req.originalUrl
    });
  });
  console.log('✅ 404 에러 핸들러 추가 성공');
} catch (error) {
  console.error('❌ 404 에러 핸들러 추가 실패:', error.message);
  process.exit(1);
}

console.log('🔧 Step 4: 에러 핸들링 미들웨어 추가 시도...');
try {
  app.use((err, req, res, next) => {
    console.error('❌ 서버 에러:', err);
    res.status(500).json({
      success: false,
      error: '서버 내부 오류가 발생했습니다',
      timestamp: new Date().toISOString()
    });
  });
  console.log('✅ 에러 핸들링 미들웨어 추가 성공');
} catch (error) {
  console.error('❌ 에러 핸들링 미들웨어 추가 실패:', error.message);
  process.exit(1);
}

console.log('🔧 Step 5: 서버 시작 시도...');
try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('🎉 모든 단계가 성공적으로 완료되었습니다!');
  });
} catch (error) {
  console.error('❌ 서버 시작 실패:', error.message);
  process.exit(1);
}