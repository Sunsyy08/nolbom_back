// routes/missing.js - 실종자 관련 API (기존 DB 구조 활용)
const express = require('express');
const { db, calculateAge } = require('../db');
const router = express.Router();

// 실종자 목록 조회 (프론트엔드용)
router.get('/', (req, res) => {
    const { status = 'MISSING', limit = 50, offset = 0 } = req.query;
    
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
            w.height,
            w.weight,
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
                error: '실종자 목록 조회 실패' 
            });
        }
        
        // 데이터 가공 (나이 계산, 프로필 이미지 처리)
        const processedRows = rows.map(row => {
            const age = calculateAge(row.birthdate);
            
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
                // GPS 위치 (ward_status 또는 missing_wards에서)
                current_lat: row.current_lat || row.last_lat,
                current_lng: row.current_lng || row.last_lng,
                // 프로필 이미지 처리
                profile_image: row.profile_image_data 
                    ? `data:image/jpeg;base64,${row.profile_image_data.toString('base64')}`
                    : null,
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
                    error: '실종자 개수 조회 실패' 
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
    
    if (!ward_id) {
        return res.status(400).json({ 
            success: false, 
            error: 'ward_id는 필수입니다' 
        });
    }
    
    // 노약자 정보 조회
    const getWardSql = `
        SELECT 
            w.id as ward_id,
            w.user_id,
            w.height,
            w.weight,
            u.name,
            u.birthdate,
            u.role
        FROM wards w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ? AND u.role = 'ward'
    `;
    
    db.get(getWardSql, [ward_id], (err, ward) => {
        if (err) {
            console.error('❌ 노약자 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '노약자 정보 조회 실패' 
            });
        }
        
        if (!ward) {
            return res.status(404).json({ 
                success: false, 
                error: '등록된 노약자 정보를 찾을 수 없습니다' 
            });
        }
        
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
                return res.status(400).json({ 
                    success: false, 
                    error: '이미 실종 신고된 노약자입니다',
                    existing_id: existing.id
                });
            }
            
            // ward_status에서 현재 위치 조회 (current_lat/lng가 없는 경우)
            let finalLat = current_lat;
            let finalLng = current_lng;
            
            if (!finalLat || !finalLng) {
                const locationSql = 'SELECT last_lat, last_lng FROM ward_status WHERE ward_id = ?';
                db.get(locationSql, [ward_id], (err, location) => {
                    if (!err && location) {
                        finalLat = finalLat || location.last_lat;
                        finalLng = finalLng || location.last_lng;
                    }
                    
                    insertMissingWard();
                });
            } else {
                insertMissingWard();
            }
            
            function insertMissingWard() {
                // 실종자 등록
                const insertSql = `
                    INSERT INTO missing_wards 
                    (ward_id, last_lat, last_lng, notes, sms_sent)
                    VALUES (?, ?, ?, ?, 1)
                `;
                
                db.run(insertSql, [
                    ward_id, 
                    finalLat || null, 
                    finalLng || null, 
                    notes || `응급 상황으로 인한 자동 등록`
                ], function(err) {
                    if (err) {
                        console.error('❌ 실종자 등록 실패:', err);
                        return res.status(500).json({ 
                            success: false, 
                            error: '실종자 등록 실패' 
                        });
                    }
                    
                    console.log(`✅ 새 실종자 등록: ${ward.name} (ward_id: ${ward_id}, missing_id: ${this.lastID})`);
                    
                    res.json({
                        success: true,
                        message: '실종자가 성공적으로 등록되었습니다',
                        missing_id: this.lastID,
                        ward_id: ward_id,
                        name: ward.name,
                        age: calculateAge(ward.birthdate)
                    });
                });
            }
        });
    });
});

// 실종자 발견 처리
router.put('/:id/found', (req, res) => {
    const { id } = req.params;
    const { found_lat, found_lng, notes } = req.body;
    
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
        
        console.log(`✅ 실종자 발견 처리: ID ${id}`);
        
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