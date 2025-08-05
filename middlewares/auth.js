// middlewares/auth.js
const jwt = require('jsonwebtoken');


// JWT 비밀키 - .env에서 불러오는 방식으로 바꿔도 됨
const JWT_SECRET = 'my_secret_key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <토큰>

  if (!token) {
    return res.status(401).json({ error: '토큰이 없습니다. 접근이 제한됩니다.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
    }

    // 유효한 경우 사용자 정보(req.user)에 저장
    req.user = decoded; // { user_id, role }
    next();
  });
}

module.exports = authenticateToken;
