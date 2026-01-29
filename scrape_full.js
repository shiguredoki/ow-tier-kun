const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
chromium.use(stealth);

// ■■■ 収集設定 ■■■
// 収集対象のマップリスト
const TARGET_MAPS = [
    'all-maps',
    // エスコート
    'circuit-royal', 'dorado', 'havana', 'junkertown', 
    'rialto', 'route-66', 'shambali-monastery', 'watchpoint-gibraltar',
    // ハイブリッド
    'blizzard-world', 'eichenwalde', 'hollywood', 'midtown', 
    'numbani', 'paraiso', 'kings-row',
    // コントロール
    'busan', 'ilios', 'lijiang-tower', 'nepal', 'oasis', 
    'samoa', 'antarctic-peninsula',
    // プッシュ
    'colosseo', 'esperanca', 'new-queen-street', 'runasapi',
    // フラッシュポイント
    'new-junk-city', 'suravasa',
    // クラッシュ
    'hanaoka', 'throne-of-anubis'
];

const CONFIG = {
    region: 'Asia',
    input: 'PC',
    mode: 'Competitive'
};

(async () => {
    console.log('🏭 全マップ完全収集機 (GM対応版)、起動します。');
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();

    let fullData = { meta: CONFIG, lastUpdated: "", data: {} };
    try {
        if (fs.existsSync('data.json')) {
            fullData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        }
    } catch (e) {
        console.log("⚠️ 新規作成します");
    }

    const ROLES = [
        { label: 'タンク',   param: 'Tank',    key: 'tank' },
        { label: 'ダメージ', param: 'Damage',  key: 'damage' },
        { label: 'サポート', param: 'Support', key: 'support' }
    ];

    // --- メインループ ---
    for (const mapId of TARGET_MAPS) {
        console.log(`\n###################################`);
        console.log(`🗺️ マップ: [${mapId}] 収集中...`);

        if (!fullData.data[mapId]) {
            fullData.data[mapId] = { tank: {}, damage: {}, support: {} };
        }

        for (const role of ROLES) {
            process.stdout.write(`  🛡️ ${role.label}: `);
            const targetUrl = `https://overwatch.blizzard.com/ja-jp/rates/?input=${CONFIG.input}&map=${mapId}&region=${CONFIG.region}&role=${role.param}&rq=1&tier=All`;
            
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(1000);

                const tierSelect = page.locator('select').nth(3);

                // ★修正: 選択肢のテキストを動的に取得（名前ミス防止）
                const options = await tierSelect.evaluate(select => {
                    return Array.from(select.options).map(o => o.text);
                });

                // 取得した選択肢を順番に回す
                for (const rankLabel of options) {
                    await tierSelect.selectOption({ label: rankLabel });
                    await page.waitForTimeout(300); // 待ち時間

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

                    // ID変換（部分一致で判定）
                    let rankId = 'unknown';
                    if (rankLabel.includes('すべて')) rankId = 'all';
                    else if (rankLabel.includes('ブロンズ')) rankId = 'bronze';
                    else if (rankLabel.includes('シルバー')) rankId = 'silver';
                    else if (rankLabel.includes('ゴールド')) rankId = 'gold';
                    else if (rankLabel.includes('プラチナ')) rankId = 'platinum';
                    else if (rankLabel.includes('ダイヤモンド')) rankId = 'diamond';
                    else if (rankLabel.includes('マスター')) rankId = 'master';
                    // ★GMとチャンピオンをここでキャッチ
                    else if (rankLabel.includes('グランド') || rankLabel.includes('チャンピオン')) rankId = 'grandmaster_champion';

                    fullData.data[mapId][role.key][rankId] = heroes;
                }
                process.stdout.write(`✅ 完了 `);

            } catch (e) {
                process.stdout.write(`❌ エラー `);
            }
        }
        
        fullData.lastUpdated = new Date().toLocaleString('ja-JP');
        fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
    }

    console.log(`\n\n🎉 全マップの収集完了！`);
    await browser.close();
})();