const https = require('https');

const TARGET_URL = 'https://nuke-iukw.onrender.com/';
const INTERVAL = 10 * 60 * 1000; // 10분

function ping() {
  const start = Date.now();

  const request = https.get(TARGET_URL, (res) => {
    res.resume();

    const time = Date.now() - start;

    console.log(
      `[${new Date().toISOString()}] 🏓 Render 핑 완료 | HTTP ${res.statusCode} | ${time}ms`
    );
  });

  request.setTimeout(30000, () => {
    request.destroy(new Error('요청 시간 초과'));
  });

  request.on('error', (error) => {
    console.error(
      `[${new Date().toISOString()}] ❌ Render 핑 실패 | ${error.message}`
    );
  });
}

ping();
setInterval(ping, INTERVAL);
