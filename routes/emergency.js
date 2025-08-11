// routes/emergency.js - ward_id 포함 버전으로 수정
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const router = express.Router();

// 응급 신고용 데이터베이스 연결 (기존 nolbom.db 사용)
const emergencyDb = new sqlite3.Database('nolbom.db', (err) => {
    if (err) {
        console.error('❌ 응급 DB 연결 실패:', err.message);
    } else {
        console.log('✅ 응급 신고 시스템 연결 성공');
    }
});

// 응급 신고 기록 저장 (ward_id 포함)
router.post('/report', (req, res) => {
    const { user_name, detected_keyword, ward_id } = req.body;

    // 필수 필드 검증
    if (!user_name || !detected_keyword) {
        return res.status(400).json({
            success: false,
            error: '사용자 이름과 감지된 키워드는 필수입니다.'
        });
    }

    const sql = `
        INSERT INTO emergency_reports (user_name, detected_keyword, ward_id)
        VALUES (?, ?, ?)
    `;

    emergencyDb.run(sql, [user_name, detected_keyword, ward_id || null], function(err) {
        if (err) {
            console.error('응급 신고 저장 실패:', err);
            return res.status(500).json({
                success: false,
                error: '신고 기록 저장 실패',
                details: err.message
            });
        }

        console.log(`📋 응급 신고 저장 완료 - ID: ${this.lastID}, 노약자 ID: ${ward_id || 'null'}, 사용자: ${user_name}, 키워드: ${detected_keyword}`);
        
        res.json({
            success: true,
            report_id: this.lastID,
            ward_id: ward_id,
            message: '응급 신고가 저장되었습니다.'
        });
    });
});

// 응급 신고 기록 조회 (노약자 정보 포함)
router.get('/reports', (req, res) => {
    const { 
        page = 1, 
        limit = 20, 
        user_name, 
        keyword,
        ward_id 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    // wards 테이블과 JOIN해서 노약자 정보도 함께 조회
    let sql = `
        SELECT 
            er.*,
            w.home_address,
            w.medical_status,
            w.emergency_contact_1,
            w.emergency_contact_2,
            u.name as ward_name,
            u.phone as ward_phone
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        WHERE 1=1
    `;
    let params = [];
    
    // 필터 조건 추가
    if (user_name) {
        sql += ' AND er.user_name LIKE ?';
        params.push(`%${user_name}%`);
    }
    
    if (keyword) {
        sql += ' AND er.detected_keyword LIKE ?';
        params.push(`%${keyword}%`);
    }
    
    if (ward_id) {
        sql += ' AND er.ward_id = ?';
        params.push(ward_id);
    }
    
    sql += ' ORDER BY er.report_time DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    emergencyDb.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        // 총 개수도 조회
        const countSQL = `
            SELECT COUNT(*) as total 
            FROM emergency_reports er
            LEFT JOIN wards w ON er.ward_id = w.id
            LEFT JOIN users u ON w.user_id = u.id
            WHERE 1=1
        ` + (user_name ? ' AND er.user_name LIKE ?' : '') + 
            (keyword ? ' AND er.detected_keyword LIKE ?' : '') +
            (ward_id ? ' AND er.ward_id = ?' : '');
        
        const countParams = params.slice(0, -2); // LIMIT, OFFSET 제거
        
        emergencyDb.get(countSQL, countParams, (err, countRow) => {
            if (err) {
                return res.status(500).json({ 
                    success: false, 
                    error: err.message 
                });
            }
            
            res.json({
                success: true,
                reports: rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countRow.total,
                    total_pages: Math.ceil(countRow.total / limit)
                }
            });
        });
    });
});

// 대시보드 통계 (노약자 정보 포함)
router.get('/stats/dashboard', (req, res) => {
    const queries = [
        // 오늘 신고 수
        `SELECT COUNT(*) as today_reports FROM emergency_reports WHERE date(report_time) = date('now')`,
        // 전체 신고 수
        `SELECT COUNT(*) as total_reports FROM emergency_reports`,
        // 최근 10개 신고 (노약자 정보 포함)
        `SELECT 
            er.*,
            w.home_address,
            u.name as ward_name,
            u.phone as ward_phone
         FROM emergency_reports er
         LEFT JOIN wards w ON er.ward_id = w.id
         LEFT JOIN users u ON w.user_id = u.id
         ORDER BY er.report_time DESC 
         LIMIT 10`
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            emergencyDb.all(query, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    )).then(results => {
        res.json({
            success: true,
            dashboard: {
                today_reports: results[0][0].today_reports,
                total_reports: results[1][0].total_reports,
                recent_reports: results[2]
            }
        });
    }).catch(err => {
        console.error('대시보드 통계 조회 실패:', err.message);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    });
});

// 노약자별 신고 통계
router.get('/stats/wards', (req, res) => {
    const { period = 30 } = req.query;
    
    const sql = `
        SELECT 
            er.ward_id,
            u.name as ward_name,
            u.phone as ward_phone,
            w.home_address,
            COUNT(*) as report_count,
            MAX(er.report_time) as last_report,
            MIN(er.report_time) as first_report
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        WHERE date(er.report_time) >= date('now', '-${period} days')
        AND er.ward_id IS NOT NULL
        GROUP BY er.ward_id, u.name, u.phone, w.home_address
        ORDER BY report_count DESC
    `;
    
    emergencyDb.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            period_days: parseInt(period),
            ward_stats: rows
        });
    });
});

// 특정 노약자의 신고 이력
router.get('/wards/:ward_id/reports', (req, res) => {
    const { ward_id } = req.params;
    const { limit = 10 } = req.query;
    
    const sql = `
        SELECT 
            er.*,
            w.home_address,
            w.medical_status,
            w.emergency_contact_1,
            u.name as ward_name,
            u.phone as ward_phone
        FROM emergency_reports er
        LEFT JOIN wards w ON er.ward_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        WHERE er.ward_id = ? 
        ORDER BY er.report_time DESC 
        LIMIT ?
    `;
    
    emergencyDb.all(sql, [ward_id, limit], (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            ward_id: parseInt(ward_id),
            report_count: rows.length,
            reports: rows
        });
    });
});

// 노약자 목록 조회 (신고 횟수 포함)
router.get('/wards', (req, res) => {
    const sql = `
        SELECT 
            w.id as ward_id,
            u.name as ward_name,
            u.phone as ward_phone,
            w.home_address,
            w.medical_status,
            w.emergency_contact_1,
            COUNT(er.id) as total_reports,
            MAX(er.report_time) as last_report
        FROM wards w
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN emergency_reports er ON w.id = er.ward_id
        GROUP BY w.id, u.name, u.phone, w.home_address, w.medical_status, w.emergency_contact_1
        ORDER BY total_reports DESC, u.name
    `;
    
    emergencyDb.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            wards: rows
        });
    });
});

module.exports = router;