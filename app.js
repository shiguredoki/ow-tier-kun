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

// 偏差値(T-Score)からランクを判定
// 50が平均。60以上でS。
function getTierFromScore(score) {
    if (score >= 60) return 'S';
    if (score >= 55) return 'A';
    if (score >= 50) return 'B';
    if (score >= 45) return 'C';
    return 'D';
}

// 標準偏差などを計算する便利関数
function calculateStats(values) {
    const total = values.reduce((sum, v) => sum + v, 0);
    const avg = total / (values.length || 1);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (values.length || 1);
    const stdDev = Math.sqrt(variance) || 1; // 0除算防止
    return { avg, stdDev };
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/tier')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const targetRank = urlParams.searchParams.get('rank') || 'all';
        const targetRole = urlParams.searchParams.get('role') || 'all';
        const targetMap  = urlParams.searchParams.get('map')  || 'all-maps';

        fs.readFile('./data.json', (err, content) => {
            if (err) {
                res.writeHead(500); res.end(JSON.stringify({ error: 'Data file missing' })); return;
            }

            let json;
            try { json = JSON.parse(content); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }
            
            const mapData = json.data[targetMap] || json.data['all-maps'];
            
            if (!mapData) {
                // マップデータが無い場合
                const availableMaps = Object.keys(json.data).filter(k => k !== 'meta' && k !== 'lastUpdated');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ tierData: {S:[],A:[],B:[],C:[],D:[]}, meta: {avg:0}, availableMaps, error: "Map data not ready" }));
                return;
            }

            // ■ ヒーローデータの統合とフィルタリング
            let rawHeroes = [];
            if (targetRole === 'all') {
                const tanks = mapData.tank ? (mapData.tank[targetRank] || []) : [];
                const dmgs = mapData.damage ? (mapData.damage[targetRank] || []) : [];
                const supps = mapData.support ? (mapData.support[targetRank] || []) : [];
                
                // 全ロール結合時の重複削除
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

            // 名簿フィルタ
            let allowedNames = [];
            if (targetRole === 'all') {
                allowedNames = [...HERO_ROLES.tank, ...HERO_ROLES.damage, ...HERO_ROLES.support];
            } else {
                allowedNames = HERO_ROLES[targetRole] || [];
            }
            let cleanHeroes = rawHeroes.filter(h => allowedNames.includes(h.name));
            if (cleanHeroes.length === 0 && rawHeroes.length > 0) cleanHeroes = rawHeroes;

            // ■■■ ここが重要：数値変換とスコア計算 ■■■
            
            // 1. 数値化
            const processedHeroes = cleanHeroes.map(h => {
                const win = parseFloat(h.winRate.replace('%', '')) || 0;
                const pick = parseFloat(h.pickRate.replace('%', '')) || 0;
                return { ...h, winVal: win, pickVal: pick };
            });

            // 2. 勝率と使用率、それぞれの平均と標準偏差を計算
            const winStats = calculateStats(processedHeroes.map(h => h.winVal));
            const pickStats = calculateStats(processedHeroes.map(h => h.pickVal));

            // 3. 偏差値計算と合体
            const tierResult = { S: [], A: [], B: [], C: [], D: [] };

            processedHeroes.forEach(h => {
                // 勝率の偏差値 (Win T-Score)
                const winZ = (h.winVal - winStats.avg) / winStats.stdDev;
                const winT = 50 + (winZ * 10);

                // 使用率の偏差値 (Pick T-Score)
                const pickZ = (h.pickVal - pickStats.avg) / pickStats.stdDev;
                const pickT = 50 + (pickZ * 10);

                // ★最終スコア計算 (重み付け平均)
                // 勝率 1.0 : 使用率 0.7 の比率で評価
                const weightWin = 1.0;
                const weightPick = 0.7;
                const finalScore = ((winT * weightWin) + (pickT * weightPick)) / (weightWin + weightPick);

                const tier = getTierFromScore(finalScore);
                
                // 表示用に値を保存
                h.score = finalScore.toFixed(1);
                h.winT = winT.toFixed(1);
                
                tierResult[tier].push(h);
            });

            // スコア順にソート
            Object.keys(tierResult).forEach(t => {
                tierResult[t].sort((a, b) => b.score - a.score);
            });

            // ■ 修正: マップリストから 'tank', 'damage' などを除外
            const ignoreKeys = ['tank', 'damage', 'support', 'meta', 'lastUpdated'];
            const availableMaps = Object.keys(json.data).filter(key => !ignoreKeys.includes(key));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                lastUpdated: json.lastUpdated,
                tierData: tierResult,
                meta: { avg: winStats.avg.toFixed(1), role: targetRole, map: targetMap },
                availableMaps: availableMaps 
            }));
        });
        return;
    }

    // ファイル配信
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

console.log(`🚀 サーバー起動 (http://localhost:${PORT})`);
server.listen(PORT);