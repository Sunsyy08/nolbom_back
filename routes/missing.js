// routes/missing.js - 실종자 관련 API (기존 DB 구조 활용)
const express = require('express');
const db = require('../db');
const router = express.Router();

// 나이 계산 함수 추가
function calculateAge(birthdate) {
    if (!birthdate) return null;
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }
  

// 실종자 목록 조회 (프론트엔드용)
router.get('/', (req, res) => {
    const { status = 'MISSING', limit = 50, offset = 0 } = req.query;
    
    console.log(`📋 실종자 목록 조회: status=${status}, limit=${limit}`);
    
    const sql = `
        SELECT 
            mw.id as missing_id,
            mw.ward_id,
            mw.detected_at,
            mw.last_lat,
            mw.last_lng,
            mw.status,
            mw.notes,
            mw.sms_sent,
            mw.updated_at,
            u.name,
            u.birthdate,
            u.phone,
            u.gender,
            w.height AS height,
            w.weight AS weight,
            w.home_address,
            w.medical_status,
            w.profile_image_data,
            ws.last_lat as current_lat,
            ws.last_lng as current_lng
        FROM missing_wards mw
        JOIN wards w ON mw.ward_id = w.id
        JOIN users u ON w.user_id = u.id
        LEFT JOIN ward_status ws ON mw.ward_id = ws.ward_id
        WHERE mw.status = ?
        ORDER BY mw.detected_at DESC 
        LIMIT ? OFFSET ?
    `;
    
    db.all(sql, [status, limit, offset], (err, rows) => {
        if (err) {
            console.error('❌ 실종자 목록 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '실종자 목록 조회 실패',
                data: [],
                total: 0,
                count: 0
            });
        }
        
        console.log(`✅ 실종자 ${rows.length}명 조회 완료`);
        
        // 데이터 가공 (나이 계산, 프로필 이미지 처리)
        // 데이터 가공 (나이 계산, 프로필 이미지 처리)
const processedRows = rows.map(row => {
    const age = calculateAge(row.birthdate);
    
    // 🔍 프로필 이미지 디버깅 로그 추가
    const hasProfileImage = row.profile_image_data ? true : false;
    const imageSize = row.profile_image_data ? row.profile_image_data.length : 0;
    console.log(`🖼️ ${row.name}: 프로필 이미지 ${hasProfileImage ? `있음 (${imageSize} bytes)` : '없음'}`);
    
    // 프로필 이미지 base64 변환
    let profileImageBase64 = null;
    if (row.profile_image_data) {
        try {
            profileImageBase64 = `data:image/jpeg;base64,${row.profile_image_data.toString('base64')}`;
            console.log(`✅ ${row.name}: base64 변환 성공 (길이: ${profileImageBase64.length})`);
        } catch (error) {
            console.error(`❌ ${row.name}: base64 변환 실패:`, error.message);
            profileImageBase64 = null;
        }
    }
    
    return {
        id: row.missing_id,
        ward_id: row.ward_id,
        name: row.name,
        age: age,
        height: row.height || 0,
        weight: row.weight || 0,
        gender: row.gender,
        phone: row.phone,
        home_address: row.home_address,
        medical_status: row.medical_status,
        detected_at: row.detected_at,
        status: row.status,
        notes: row.notes,
        sms_sent: row.sms_sent,
        current_lat: row.current_lat || row.last_lat,
        current_lng: row.current_lng || row.last_lng,
        profile_image: profileImageBase64,  // 수정된 부분
        updated_at: row.updated_at
    };
});

        
        // 총 개수 조회
        const countSql = 'SELECT COUNT(*) as total FROM missing_wards WHERE status = ?';
        db.get(countSql, [status], (err, countRow) => {
            if (err) {
                console.error('❌ 실종자 개수 조회 실패:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: '실종자 개수 조회 실패',
                    data: processedRows,
                    total: processedRows.length,
                    count: processedRows.length
                });
            }
            
            res.json({
                success: true,
                data: processedRows,
                total: countRow.total,
                count: processedRows.length
            });
        });
    });
});

// 특정 실종자 상세 조회
router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `
        SELECT 
            mw.*,
            u.name,
            u.birthdate,
            u.phone,
            u.email,
            u.gender,
            w.height,
            w.weight,
            w.home_address,
            w.medical_status,
            w.profile_image_data,
            w.safe_lat,
            w.safe_lng,
            w.safe_radius,
            ws.last_lat as current_lat,
            ws.last_lng as current_lng,
            ws.is_outside,
            ws.last_moved_at
        FROM missing_wards mw
        JOIN wards w ON mw.ward_id = w.id
        JOIN users u ON w.user_id = u.id
        LEFT JOIN ward_status ws ON mw.ward_id = ws.ward_id
        WHERE mw.id = ?
    `;
    
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('❌ 실종자 상세 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '실종자 조회 실패' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                success: false, 
                error: '실종자를 찾을 수 없습니다' 
            });
        }
        
        // 데이터 가공
        const processedRow = {
            ...row,
            age: calculateAge(row.birthdate),
            profile_image: row.profile_image_data 
                ? `data:image/jpeg;base64,${row.profile_image_data.toString('base64')}`
                : null,
            profile_image_data: undefined // blob 제거
        };
        
        res.json({
            success: true,
            data: processedRow
        });
    });
});

// 실종자 등록 (Python FastAPI에서 호출)
router.post('/', (req, res) => {
    const { ward_id, current_lat, current_lng, notes } = req.body;
    
    console.log(`📝 실종자 등록 요청: ward_id=${ward_id}`);
    
    if (!ward_id) {
        return res.status(400).json({ 
            success: false, 
            error: 'ward_id는 필수입니다' 
        });
    }
    
    // 기존 사용자가 있는지 확인 (더미 사용자 생성)
    const checkUserSql = 'SELECT COUNT(*) as count FROM users WHERE id = ?';
    db.get(checkUserSql, [ward_id], (err, userCheck) => {
        if (err) {
            console.error('❌ 사용자 확인 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '사용자 확인 실패' 
            });
        }
        
        // 사용자가 없으면 더미 사용자 생성
        if (userCheck.count === 0) {
            console.log(`🔧 더미 사용자 생성: ID ${ward_id}`);
            
            const createUserSql = `
                INSERT INTO users (id, name, email, password, role, height, weight, birthdate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            db.run(createUserSql, [
                ward_id,
                `사용자${ward_id}`,
                `user${ward_id}@nolbom.com`,
                'dummy_password',
                'ward',
                170, // 기본 키
                60,  // 기본 몸무게
                '1945-01-01' // 기본 생년월일 (약 80세)
            ], (err) => {
                if (err) {
                    console.error('❌ 더미 사용자 생성 실패:', err);
                    return res.status(500).json({ 
                        success: false, 
                        error: '더미 사용자 생성 실패' 
                    });
                }
                
                // 더미 ward 생성
                createDummyWard();
            });
        } else {
            // 기존 사용자가 있으면 바로 ward 확인
            checkWard();
        }
    });
    
    function createDummyWard() {
        const createWardSql = `
            INSERT OR IGNORE INTO wards (id, user_id, height, weight, home_address)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        db.run(createWardSql, [
            ward_id,
            ward_id,
            170,
            60,
            '서울시 강남구'
        ], (err) => {
            if (err) {
                console.error('❌ 더미 ward 생성 실패:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: '더미 ward 생성 실패' 
                });
            }
            
            insertMissingWard();
        });
    }
    
    function checkWard() {
        const checkWardSql = 'SELECT COUNT(*) as count FROM wards WHERE id = ?';
        db.get(checkWardSql, [ward_id], (err, wardCheck) => {
            if (err || wardCheck.count === 0) {
                createDummyWard();
            } else {
                insertMissingWard();
            }
        });
    }
    
    function insertMissingWard() {
        // 중복 실종 신고 체크
        const checkSql = 'SELECT id FROM missing_wards WHERE ward_id = ? AND status = "MISSING"';
        db.get(checkSql, [ward_id], (err, existing) => {
            if (err) {
                console.error('❌ 중복 체크 실패:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: '중복 체크 실패' 
                });
            }
            
            if (existing) {
                console.log(`⚠️ 이미 실종 신고된 사용자: ${ward_id}`);
                return res.status(400).json({ 
                    success: false, 
                    error: '이미 실종 신고된 사용자입니다',
                    existing_id: existing.id
                });
            }
            
            // 실종자 등록
            const insertSql = `
                INSERT INTO missing_wards 
                (ward_id, last_lat, last_lng, notes, sms_sent)
                VALUES (?, ?, ?, ?, 1)
            `;
            
            db.run(insertSql, [
                ward_id, 
                current_lat || null, 
                current_lng || null, 
                notes || `응급 상황으로 인한 자동 등록`
            ], function(err) {
                if (err) {
                    console.error('❌ 실종자 등록 실패:', err);
                    return res.status(500).json({ 
                        success: false, 
                        error: '실종자 등록 실패' 
                    });
                }
                
                console.log(`✅ 새 실종자 등록: ward_id ${ward_id} (missing_id: ${this.lastID})`);
                
                res.json({
                    success: true,
                    message: '실종자가 성공적으로 등록되었습니다',
                    missing_id: this.lastID,
                    ward_id: ward_id
                });
            });
        });
    }
});

// 실종자 발견 처리
router.put('/:id/found', (req, res) => {
    const { id } = req.params;
    const { found_lat, found_lng, notes } = req.body;
    
    console.log(`🔍 실종자 발견 처리: ID ${id}`);
    
    const sql = `
        UPDATE missing_wards 
        SET status = 'FOUND', 
            updated_at = CURRENT_TIMESTAMP,
            last_lat = COALESCE(?, last_lat),
            last_lng = COALESCE(?, last_lng),
            notes = COALESCE(?, notes)
        WHERE id = ? AND status = 'MISSING'
    `;
    
    db.run(sql, [found_lat, found_lng, notes, id], function(err) {
        if (err) {
            console.error('❌ 실종자 발견 처리 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '발견 처리 실패' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                error: '해당 실종자를 찾을 수 없거나 이미 발견된 상태입니다' 
            });
        }
        
        console.log(`✅ 실종자 발견 처리 완료: ID ${id}`);
        
        res.json({
            success: true,
            message: '실종자 발견 처리가 완료되었습니다'
        });
    });
});

// 위치 업데이트 (실시간 GPS)
router.put('/:id/location', (req, res) => {
    const { id } = req.params;
    const { lat, lng } = req.body;
    
    if (!lat || !lng) {
        return res.status(400).json({ 
            success: false, 
            error: '위도(lat)와 경도(lng)가 필요합니다' 
        });
    }
    
    // missing_wards와 ward_status 모두 업데이트
    db.serialize(() => {
        // 1. missing_wards 업데이트
        const updateMissingSql = `
            UPDATE missing_wards 
            SET last_lat = ?, last_lng = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        db.run(updateMissingSql, [lat, lng, id], function(err) {
            if (err) {
                console.error('❌ 실종자 위치 업데이트 실패:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: '위치 업데이트 실패' 
                });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ 
                    success: false, 
                    error: '해당 실종자를 찾을 수 없습니다' 
                });
            }
            
            // 2. ward_status도 업데이트 (현재 위치 동기화)
            const getWardIdSql = 'SELECT ward_id FROM missing_wards WHERE id = ?';
            db.get(getWardIdSql, [id], (err, row) => {
                if (!err && row) {
                    const updateWardStatusSql = `
                        UPDATE ward_status 
                        SET last_lat = ?, last_lng = ?, last_moved_at = ?
                        WHERE ward_id = ?
                    `;
                    
                    db.run(updateWardStatusSql, [lat, lng, Date.now(), row.ward_id], (err) => {
                        if (err) {
                            console.error('❌ ward_status 위치 업데이트 실패:', err);
                        }
                    });
                }
            });
            
            res.json({
                success: true,
                message: '위치가 업데이트되었습니다'
            });
        });
    });
});

module.exports = router;