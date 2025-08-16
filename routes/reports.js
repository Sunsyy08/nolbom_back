// routes/reports.js - 신고 이력 관련 API (기존 emergency_reports 활용)
const express = require('express');
const db = require('../db');
const router = express.Router();

// 신고 이력 저장 (Python FastAPI에서 호출)
router.post('/', (req, res) => {
    const {
        user_name,
        detected_keyword,
        ward_id,
        transcript,
        confidence,
        missing_ward_id,
        sms_sent
    } = req.body;
    
    if (!user_name || !detected_keyword) {
        return res.status(400).json({ 
            success: false, 
            error: 'user_name과 detected_keyword는 필수입니다' 
        });
    }
    
    const sql = `
        INSERT INTO emergency_reports (
            user_name, 
            detected_keyword, 
            ward_id,
            transcript, 
            confidence,
            missing_ward_id,
            sms_sent
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        user_name, 
        detected_keyword, 
        ward_id || null,
        transcript || '', 
        confidence || null,
        missing_ward_id || null,
        sms_sent ? 1 : 0
    ], function(err) {
        if (err) {
            console.error('❌ 신고 이력 저장 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '신고 이력 저장 실패' 
            });
        }
        
        console.log(`✅ 신고 이력 저장: ID ${this.lastID}, 사용자: ${user_name}`);
        
        res.json({
            success: true,
            message: '신고 이력이 저장되었습니다',
            report_id: this.lastID
        });
    });
});

// 신고 이력 조회
router.get('/', (req, res) => {
    const { 
        limit = 20, 
        offset = 0, 
        ward_id,
        keyword_only = false 
    } = req.query;
    
    let sql = `
        SELECT 
            er.id,
            er.user_name,
            er.detected_keyword,
            er.ward_id,
            er.transcript,
            er.confidence,
            er.missing_ward_id,
            er.sms_sent,
            er.report_time,
            u.name as ward_name,
            u.phone as ward_phone,
            mw.status as missing_status
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN missing_wards mw ON er.missing_ward_id = mw.id
        WHERE 1=1
    `;
    
    const params = [];
    
    // 특정 노약자별 필터
    if (ward_id) {
        sql += ' AND er.ward_id = ?';
        params.push(ward_id);
    }
    
    // 키워드 감지된 것만 조회
    if (keyword_only === 'true') {
        sql += ' AND er.detected_keyword IS NOT NULL AND er.detected_keyword != ""';
    }
    
    sql += ' ORDER BY er.report_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('❌ 신고 이력 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '신고 이력 조회 실패' 
            });
        }
        
        res.json({
            success: true,
            data: rows,
            count: rows.length
        });
    });
});

// 특정 신고 상세 조회
router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `
        SELECT 
            er.*,
            u.name as ward_name,
            u.phone as ward_phone,
            u.birthdate,
            u.gender,
            w.height,
            w.weight,
            w.home_address,
            w.medical_status,
            mw.status as missing_status,
            mw.last_lat,
            mw.last_lng,
            mw.detected_at as missing_detected_at
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN missing_wards mw ON er.missing_ward_id = mw.id
        WHERE er.id = ?
    `;
    
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('❌ 신고 상세 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '신고 상세 조회 실패' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                success: false, 
                error: '신고 내역을 찾을 수 없습니다' 
            });
        }
        
        res.json({
            success: true,
            data: row
        });
    });
});

// 오늘의 신고 통계
router.get('/stats/today', (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) as total_reports,
            COUNT(CASE WHEN detected_keyword IS NOT NULL AND detected_keyword != '' THEN 1 END) as keyword_reports,
            COUNT(CASE WHEN sms_sent = 1 THEN 1 END) as sms_sent_count,
            COUNT(CASE WHEN missing_ward_id IS NOT NULL THEN 1 END) as missing_created_count
        FROM emergency_reports 
        WHERE DATE(report_time) = DATE('now')
    `;
    
    db.get(sql, [], (err, row) => {
        if (err) {
            console.error('❌ 오늘 신고 통계 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '통계 조회 실패' 
            });
        }
        
        res.json({
            success: true,
            stats: {
                total_reports: row.total_reports,
                keyword_reports: row.keyword_reports,
                sms_sent_count: row.sms_sent_count,
                missing_created_count: row.missing_created_count,
                date: new Date().toISOString().split('T')[0]
            }
        });
    });
});

// 특정 노약자의 신고 이력 조회
router.get('/ward/:ward_id', (req, res) => {
    const { ward_id } = req.params;
    const { limit = 10, offset = 0 } = req.query;
    
    const sql = `
        SELECT 
            er.*,
            u.name as ward_name,
            mw.status as missing_status
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN missing_wards mw ON er.missing_ward_id = mw.id
        WHERE er.ward_id = ?
        ORDER BY er.report_time DESC
        LIMIT ? OFFSET ?
    `;
    
    db.all(sql, [ward_id, limit, offset], (err, rows) => {
        if (err) {
            console.error('❌ 노약자별 신고 이력 조회 실패:', err);
            return res.status(500).json({ 
                success: false, 
                error: '신고 이력 조회 실패' 
            });
        }
        
        res.json({
            success: true,
            data: rows,
            count: rows.length
        });
    });
});

module.exports = router;