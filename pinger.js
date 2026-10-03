const https = require('https');

const TARGET_URL = 'https://nuke-iukw.onrender.com/';
const INTERVAL = 10 * 60 * 1000; // 10분

function ping() {
  https.get(TARGET_URL, (res) => {
    console.log(
      `[${new Date().toLocaleString('ko-KR')}] 🏓 핑 완료 - HTTP ${res.statusCode}`
    );

    res.on('data', () => {});
  }).on('error', (err) => {
    console.error(
      `[${new Date().toLocaleString('ko-KR')}] ❌ 핑 실패 - ${err.message}`
    );
  });
}

// 시작하자마자 한 번 실행
ping();

// 이후 10분마다 실행
setInterval(ping, INTERVAL);
