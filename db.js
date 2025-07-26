// db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('nolbom.db');

// 테이블 생성
db.serialize(() => {
  // users 테이블 (공통 회원 정보)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      birthdate TEXT NOT NULL,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('guardian', 'ward')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // guardians 테이블 (보호자 전용 정보)
  db.run(`
    CREATE TABLE IF NOT EXISTS guardians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      address TEXT,
      relation TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // wards 테이블 (노약자 전용 정보)
  db.run(`
    CREATE TABLE IF NOT EXISTS wards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      gender TEXT,
      medical_info TEXT,
      home_address TEXT,
      photo_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

module.exports = db;
