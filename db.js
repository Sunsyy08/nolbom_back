// db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('nolbom.db');

// 테이블 생성
db.serialize(() => {
  // users 테이블 (공통 회원 정보)
  db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    birthdate  TEXT    ,
    phone      TEXT    ,
    gender TEXT,
    role       TEXT     CHECK (role IN ('guardian', 'ward')),
    height     REAL,          -- 신장(cm) or m 단위로 저장
    weight     REAL,          -- 체중(kg) 저장
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);


  // guardians 테이블 (보호자 전용 정보)
  db.run(`
  CREATE TABLE IF NOT EXISTS guardians (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    ward_id    INTEGER NOT NULL,
    address    TEXT,
    relation   TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE CASCADE
  );
  `);

  // wards 테이블 (노약자 전용 정보)
  db.run(`
  CREATE TABLE IF NOT EXISTS wards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    height          REAL    DEFAULT 0,
    weight          REAL    DEFAULT 0,
    medical_status  TEXT    DEFAULT '',
    home_address    TEXT    DEFAULT '',
    profile_image   TEXT,
    profile_image_data BLOB,
    safe_lat        REAL,
    safe_lng        REAL,
    safe_radius     REAL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
db.run(`
  CREATE TABLE IF NOT EXISTS ward_status (
    ward_id        INTEGER PRIMARY KEY,                        -- wards.id와 1:1
    is_outside     INTEGER DEFAULT 0,                          -- 0:집 안, 1:외출 중
    last_alert_time INTEGER DEFAULT 0,                         -- 마지막 알림 시각(ms)
    alert_interval INTEGER DEFAULT 10,                         -- 알림 반복 간격(초)
    last_lat       REAL    DEFAULT 0,                          -- 마지막 위도
    last_lng       REAL    DEFAULT 0,                          -- 마지막 경도
    last_moved_at  INTEGER DEFAULT 0,                          -- 마지막 이동 시각(ms)
    FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE CASCADE
  );
`);

// db.run(`ALTER TABLE ward_status ADD COLUMN last_lat REAL`);
// db.run(`ALTER TABLE ward_status ADD COLUMN last_lng REAL`);
// db.run(`ALTER TABLE ward_status ADD COLUMN last_moved_at INTEGER`);

// 실종자 목록 테이블 (기존 missing_wards 활용)
db.run(`
CREATE TABLE IF NOT EXISTS missing_wards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ward_id INTEGER,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_lat REAL,
  last_lng REAL,
  status TEXT DEFAULT 'MISSING',  -- MISSING, FOUND
  notes TEXT,
  sms_sent INTEGER DEFAULT 1,     -- SMS 전송 여부
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE CASCADE
)
`);
// 신고 이력 테이블 (기존 emergency_reports 활용 + 확장)
db.run(`
    CREATE TABLE IF NOT EXISTS emergency_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name VARCHAR(100) NOT NULL,              -- 사용자 이름
      detected_keyword VARCHAR(100) NOT NULL,       -- 감지된 키워드
      ward_id INTEGER,                              -- 노약자 ID (wards 테이블 참조)
      transcript TEXT,                              -- 음성 인식 전체 텍스트
      confidence REAL,                              -- 음성 인식 신뢰도
      missing_ward_id INTEGER,                      -- 생성된 실종자 ID
      sms_sent INTEGER DEFAULT 0,                   -- SMS 전송 여부
      report_time DATETIME DEFAULT CURRENT_TIMESTAMP, -- 신고 시간
      FOREIGN KEY(ward_id) REFERENCES wards(id),
      FOREIGN KEY(missing_ward_id) REFERENCES missing_wards(id)
    )
  `);
});

// 위치 정보
db.serialize(() => {
// 위치 기록 테이블 (GPS 위치 이력 저장)
db.run(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ward_id INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE CASCADE
);
`);
});

module.exports = db;
