const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
chromium.use(stealth);

// ■■■ 設定：主要なライバル・プレイ用マップ一覧 ■■■
// ※シーズンによってプールが変わるので適宜調整してください
const TARGET_MAPS = [
    // --- 必須 ---
    'all-maps',

    // --- エスコート ---
    'circuit-royal', 'dorado', 'havana', 'junkertown', 
    'rialto', 'route-66', 'shambali-monastery', 'watchpoint-gibraltar',

    // --- ハイブリッド ---
    'blizzard-world', 'eichenwalde', 'hollywood', 'midtown', 
    'numbani', 'paraiso', 'kings-row',

    // --- コントロール ---
    'busan', 'ilios', 'lijiang-tower', 'nepal', 'oasis', 
    'samoa', 'antarctic-peninsula',

    // --- プッシュ ---
    'colosseo', 'esperanca', 'new-queen-street', 'runasapi',

    // --- フラッシュポイント ---
    'new-junk-city', 'suravasa',

    // --- クラッシュ ---
    'hanaoka', 'throne-of-anubis'
];

const CONFIG = {
    region: 'Asia',
    input: 'PC',
    mode: 'Competitive'
};

(async () => {
    console.log('🏭 全マップ完全収集機、起動します。');
    console.log(`📋 対象マップ数: ${TARGET_MAPS.length}個`);
    console.log('☕ 時間がかかります（目安: 10分）。コーヒーでも飲んでお待ちください。');

    const browser = await chromium.launch({ headless: true }); // 高速化のため画面表示なし
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();

    // 既存データの読み込み（途中再開できるように）
    let fullData = { meta: CONFIG, lastUpdated: "", data: {} };
    try {
        if (fs.existsSync('data.json')) {
            fullData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        }
    } catch (e) {
        console.log("⚠️ 新規データファイルを作成します");
    }

    const ROLES = [
        { label: 'タンク',   param: 'Tank',    key: 'tank' },
        { label: 'ダメージ', param: 'Damage',  key: 'damage' },
        { label: 'サポート', param: 'Support', key: 'support' }
    ];

    const TIER_LABELS = [
        'すべてのティア', 'ブロンズ', 'シルバー', 'ゴールド', 
        'プラチナ', 'ダイヤモンド', 'マスター', 'グランドマスター＆チャンピオン'
    ];

    // --- メインループ ---
    for (const mapId of TARGET_MAPS) {
        console.log(`\n###################################`);
        console.log(`🗺️ マップ: [${mapId}] 収集中...`);

        // データ枠の確保
        if (!fullData.data[mapId]) {
            fullData.data[mapId] = { tank: {}, damage: {}, support: {} };
        }

        for (const role of ROLES) {
            process.stdout.write(`  🛡️ ${role.label}: `);
            
            const targetUrl = `https://overwatch.blizzard.com/ja-jp/rates/?input=${CONFIG.input}&map=${mapId}&region=${CONFIG.region}&role=${role.param}&rq=1&tier=All`;
            
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                // ページ移動直後は少し待つ
                await page.waitForTimeout(1000);

                const tierSelect = page.locator('select').nth(3);

                for (const rankLabel of TIER_LABELS) {
                    // ランク切り替え
                    await tierSelect.selectOption({ label: rankLabel });
                    await page.waitForTimeout(300); // UI反映待ち（短縮）

                    // データ取得
                    const heroes = await page.$$eval('.hero-name', (elements) => {
                        return elements.map(el => {
                            const cell = el.closest('.hero-cell');
                            if (!cell) return null;
                            const blzImage = cell.querySelector('blz-image');
                            const iconUrl = blzImage ? blzImage.getAttribute('src') : '';
                            const firstNum = cell.nextElementSibling?.innerText.trim() || '0%';
                            const secondNum = cell.nextElementSibling?.nextElementSibling?.innerText.trim() || '0%';
                            return {
                                name: el.innerText.trim(),
                                iconUrl: iconUrl,
                                winRate: firstNum,
                                pickRate: secondNum
                            };
                        }).filter(h => h !== null);
                    });

                    // ID変換
                    let rankId = rankLabel;
                    if (rankLabel.includes('すべて')) rankId = 'all';
                    else if (rankLabel.includes('ブロンズ')) rankId = 'bronze';
                    else if (rankLabel.includes('シルバー')) rankId = 'silver';
                    else if (rankLabel.includes('ゴールド')) rankId = 'gold';
                    else if (rankLabel.includes('プラチナ')) rankId = 'platinum';
                    else if (rankLabel.includes('ダイヤモンド')) rankId = 'diamond';
                    else if (rankLabel.includes('マスター')) rankId = 'master';
                    else if (rankLabel.includes('グランド')) rankId = 'grandmaster_champion';

                    fullData.data[mapId][role.key][rankId] = heroes;
                }
                process.stdout.write(`✅ 完了 `);

            } catch (e) {
                process.stdout.write(`❌ エラー `);
            }
        }
        
        // マップ1つ終わるごとに保存（クラッシュ対策）
        fullData.lastUpdated = new Date().toLocaleString('ja-JP');
        fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
    }

    console.log(`\n\n🎉 全マップの収集完了！お疲れ様でした。`);
    await browser.close();
})();