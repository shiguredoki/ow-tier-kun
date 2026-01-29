const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
chromium.use(stealth);

// 収集対象マップ
const TARGET_MAPS = [
    'all-maps',
    'circuit-royal', 'dorado', 'havana', 'junkertown', 'rialto', 'route-66', 'shambali-monastery', 'watchpoint-gibraltar',
    'blizzard-world', 'eichenwalde', 'hollywood', 'midtown', 'numbani', 'paraiso', 'kings-row',
    'busan', 'ilios', 'lijiang-tower', 'nepal', 'oasis', 'samoa', 'antarctic-peninsula',
    'colosseo', 'esperanca', 'new-queen-street', 'runasapi',
    'new-junk-city', 'suravasa',
    'hanaoka', 'throne-of-anubis'
];

const CONFIG = { region: 'Asia', input: 'PC', mode: 'Competitive' };

(async () => {
    console.log('🏭 収集機 v4 (GM＆チャンピオン一括対応版)');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();

    let fullData = { meta: CONFIG, lastUpdated: "", data: {} };
    try {
        if (fs.existsSync('data.json')) fullData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    } catch (e) { console.log("新規作成"); }

    const ROLES = [
        { label: 'タンク',   param: 'Tank',    key: 'tank' },
        { label: 'ダメージ', param: 'Damage',  key: 'damage' },
        { label: 'サポート', param: 'Support', key: 'support' }
    ];

    for (const mapId of TARGET_MAPS) {
        console.log(`\n🗺️ [${mapId}] 収集中...`);
        if (!fullData.data[mapId]) fullData.data[mapId] = { tank: {}, damage: {}, support: {} };

        for (const role of ROLES) {
            process.stdout.write(`  🛡️ ${role.label}: `);
            try {
                const targetUrl = `https://overwatch.blizzard.com/ja-jp/rates/?input=${CONFIG.input}&map=${mapId}&region=${CONFIG.region}&role=${role.param}&rq=1&tier=All`;
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(1000);

                const tierSelect = page.locator('select').nth(3);
                const options = await tierSelect.evaluate(s => Array.from(s.options).map(o => o.text));

                for (const rankLabel of options) {
                    await tierSelect.selectOption({ label: rankLabel });
                    await page.waitForTimeout(300);

                    const heroes = await page.$$eval('.hero-name', (elements) => {
                        return elements.map(el => {
                            const cell = el.closest('.hero-cell');
                            if (!cell) return null;
                            const blzImage = cell.querySelector('blz-image');
                            return {
                                name: el.innerText.trim(),
                                iconUrl: blzImage ? blzImage.getAttribute('src') : '',
                                winRate: cell.nextElementSibling?.innerText.trim() || '0%',
                                pickRate: cell.nextElementSibling?.nextElementSibling?.innerText.trim() || '0%'
                            };
                        }).filter(h => h !== null);
                    });

                    // ID変換
                    let rankId = 'unknown';
                    if (rankLabel.includes('すべて')) rankId = 'all';
                    else if (rankLabel.includes('ブロンズ')) rankId = 'bronze';
                    else if (rankLabel.includes('シルバー')) rankId = 'silver';
                    else if (rankLabel.includes('ゴールド')) rankId = 'gold';
                    else if (rankLabel.includes('プラチナ')) rankId = 'platinum';
                    else if (rankLabel.includes('ダイヤモンド')) rankId = 'diamond';
                    else if (rankLabel.includes('マスター')) rankId = 'master';
                    // ★修正: 「グランドマスター」または「チャンピオン」が含まれていれば、1つのIDにまとめる
                    else if (rankLabel.includes('グランド') || rankLabel.includes('チャンピオン')) {
                        rankId = 'grandmaster_champion';
                    }

                    if (rankId !== 'unknown') {
                        fullData.data[mapId][role.key][rankId] = heroes;
                    }
                }
                process.stdout.write(`✅ `);
            } catch (e) { process.stdout.write(`❌ `); }
        }
        
        fullData.lastUpdated = new Date().toLocaleString('ja-JP');
        fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
    }
    console.log(`\n🎉 完了`);
    await browser.close();
})();