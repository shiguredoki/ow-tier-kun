const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// ■ ヒーロー名簿
const HERO_ROLES = {
    tank: [ "D.Va", "ウィンストン", "オリーサ", "ザリア", "シグマ", "ジャンカー・クイーン", "ドゥームフィスト", "マウガ", "ラインハルト", "ラマットラ", "レッキング・ボール", "ロードホッグ" ],
    damage: [ "アッシュ", "ウィドウメイカー", "エコー", "キャスディ", "ゲンジ", "シンメトラ", "ジャンクラット", "ソジョーン", "ソルジャー76", "ソンブラ", "トールビョーン", "トレーサー", "ハンゾー", "バスティオン", "ファラ", "ベンチャー", "メイ", "リーパー" ],
    support: [ "アナ", "イラリー", "キリコ", "ジュノ", "ゼニヤッタ", "バティスト", "ブリギッテ", "マーシー", "モイラ", "ライフウィーバー", "ルシオ" ]
};

function getTierFromTScore(tScore) {
    if (tScore >= 60) return 'S';
    if (tScore >= 55) return 'A';
    if (tScore >= 50) return 'B';
    if (tScore >= 45) return 'C';
    return 'D';
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/tier')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const targetRank = urlParams.searchParams.get('rank') || 'all';
        const targetRole = urlParams.searchParams.get('role') || 'all';
        const targetMap  = urlParams.searchParams.get('map')  || 'all-maps';

        fs.readFile('./data.json', (err, content) => {
            if (err) {
                // ファイルが無い場合のエラーハンドリング
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Data file missing' }));
                return;
            }

            let json;
            try {
                json = JSON.parse(content);
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }
            
            // データ取得
            const mapData = json.data[targetMap] || json.data['all-maps'];
            
            // マップデータが無い場合（まだスクレイピングしてない等）
            if (!mapData) {
                // 存在するマップリストだけ返してあげる
                const availableMaps = Object.keys(json.data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    tierData: {S:[],A:[],B:[],C:[],D:[]}, 
                    meta: {avg:0}, 
                    availableMaps: availableMaps,
                    error: "Map data not ready" 
                }));
                return;
            }

            let rawHeroes = [];

            if (targetRole === 'all') {
                const tanks = mapData.tank ? (mapData.tank[targetRank] || []) : [];
                const dmgs = mapData.damage ? (mapData.damage[targetRank] || []) : [];
                const supps = mapData.support ? (mapData.support[targetRank] || []) : [];
                const combined = [...tanks, ...dmgs, ...supps];
                const seen = new Set();
                rawHeroes = combined.filter(h => {
                    if (seen.has(h.name)) return false;
                    seen.add(h.name);
                    return true;
                });
            } else {
                if (mapData[targetRole] && mapData[targetRole][targetRank]) {
                    rawHeroes = mapData[targetRole][targetRank];
                }
            }

            let allowedNames = [];
            if (targetRole === 'all') {
                allowedNames = [...HERO_ROLES.tank, ...HERO_ROLES.damage, ...HERO_ROLES.support];
            } else {
                allowedNames = HERO_ROLES[targetRole] || [];
            }
            let cleanHeroes = rawHeroes.filter(h => allowedNames.includes(h.name));
            if (cleanHeroes.length === 0 && rawHeroes.length > 0) cleanHeroes = rawHeroes;

            const stats = cleanHeroes.map(h => {
                const win = parseFloat(h.winRate.replace('%', '')) || 0;
                return { ...h, winVal: win };
            });

            const totalWin = stats.reduce((sum, h) => sum + h.winVal, 0);
            const avgWin = totalWin / (stats.length || 1);
            const variance = stats.reduce((sum, h) => sum + Math.pow(h.winVal - avgWin, 2), 0) / (stats.length || 1);
            const stdDev = Math.sqrt(variance) || 1;

            const tierResult = { S: [], A: [], B: [], C: [], D: [] };
            stats.forEach(h => {
                const zScore = (h.winVal - avgWin) / stdDev;
                const tScore = 50 + (zScore * 10);
                const tier = getTierFromTScore(tScore);
                h.tScore = tScore.toFixed(1);
                tierResult[tier].push(h);
            });
            Object.keys(tierResult).forEach(t => {
                tierResult[t].sort((a, b) => b.winVal - a.winVal);
            });

            // 収集済みの全マップリスト
            const availableMaps = Object.keys(json.data);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                lastUpdated: json.lastUpdated,
                tierData: tierResult,
                meta: { avg: avgWin.toFixed(1), role: targetRole, map: targetMap },
                availableMaps: availableMaps 
            }));
        });
        return;
    }

    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
    }
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(error.code == 'ENOENT' ? 404 : 500);
            res.end('Error');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

console.log(`🚀 公開用サーバー起動 (http://localhost:${PORT})`);
server.listen(PORT);