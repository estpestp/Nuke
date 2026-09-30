const express = require('express');
const session = require('express-session');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const app = express();

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nuke_0930';

if (!TOKEN) {
  console.error('DISCORD_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 6
  }
}));

// ========================================
// 서버별 설정
// ========================================

const guildSettings = new Map();

// ========================================
// Discord 봇
// ========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once('ready', () => {
  console.log(`Discord 로그인 완료: ${client.user.tag}`);
});

client.login(TOKEN);

// ========================================
// 로그인 확인
// ========================================

function requireLogin(req, res, next) {
  if (!req.session.loggedIn) {
    return res.redirect('/login');
  }

  next();
}

// ========================================
// 로그인 페이지
// ========================================

app.get('/login', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>인증봇 관리자</title>

<style>
body {
  margin: 0;
  background: #111318;
  color: white;
  font-family: Arial, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.box {
  width: 340px;
  background: #1b1e25;
  padding: 30px;
  border-radius: 16px;
  box-sizing: border-box;
}

h1 {
  margin-top: 0;
}

input {
  width: 100%;
  padding: 13px;
  margin: 10px 0;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid #444;
  background: #101218;
  color: white;
}

button {
  width: 100%;
  padding: 13px;
  border: 0;
  border-radius: 8px;
  background: #5865f2;
  color: white;
  font-weight: bold;
  cursor: pointer;
}
</style>
</head>

<body>

<div class="box">
  <h1>🤖 인증봇 관리자</h1>

  <form method="POST" action="/login">
    <input
      type="password"
      name="password"
      placeholder="관리자 비밀번호"
      required
    >

    <button type="submit">
      로그인
    </button>
  </form>
</div>

</body>
</html>
  `);
});

// ========================================
// 로그인 처리
// ========================================

app.post('/login', (req, res) => {

  if (req.body.password !== ADMIN_PASSWORD) {
    return res.send(`
      <script>
        alert('비밀번호가 올바르지 않습니다.');
        location.href='/login';
      </script>
    `);
  }

  req.session.loggedIn = true;

  res.redirect('/');
});

// ========================================
// 로그아웃
// ========================================

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ========================================
// 관리자 페이지
// ========================================

app.get('/', requireLogin, (req, res) => {

  const guilds = client.guilds.cache.map(guild => {

    const settings = guildSettings.get(guild.id) || {};

    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id)
      .map(role => `
        <option value="${role.id}"
          ${settings.roleId === role.id ? 'selected' : ''}>
          ${escapeHtml(role.name)}
        </option>
      `)
      .join('');

    const channels = guild.channels.cache
      .filter(channel => channel.isTextBased())
      .map(channel => `
        <option value="${channel.id}"
          ${settings.channelId === channel.id ? 'selected' : ''}>
          # ${escapeHtml(channel.name)}
        </option>
      `)
      .join('');

    return `
      <div class="server">

        <h2>🏠 ${escapeHtml(guild.name)}</h2>

        <form method="POST" action="/save">

          <input
            type="hidden"
            name="guildId"
            value="${guild.id}"
          >

          <label>인증 역할</label>

          <select name="roleId">
            <option value="">역할 선택</option>
            ${roles}
          </select>

          <label>인증 채널</label>

          <select name="channelId">
            <option value="">채널 선택</option>
            ${channels}
          </select>

          <button type="submit">
            설정 저장
          </button>

        </form>

        <form method="POST" action="/send-panel">

          <input
            type="hidden"
            name="guildId"
            value="${guild.id}"
          >

          <button class="green" type="submit">
            🔐 인증 패널 전송
          </button>

        </form>

      </div>
    `;
  }).join('');

  res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>인증봇 관리자</title>

<style>

body {
  margin: 0;
  background: #111318;
  color: white;
  font-family: Arial, sans-serif;
}

header {
  padding: 20px;
  background: #1b1e25;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

a {
  color: #aaa;
  text-decoration: none;
}

.container {
  max-width: 900px;
  margin: auto;
  padding: 25px;
}

.status {
  background: #1b1e25;
  padding: 18px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.server {
  background: #1b1e25;
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 20px;
}

label {
  display: block;
  margin-top: 15px;
  margin-bottom: 6px;
}

select {
  width: 100%;
  padding: 12px;
  background: #101218;
  color: white;
  border: 1px solid #444;
  border-radius: 8px;
}

button {
  width: 100%;
  padding: 12px;
  margin-top: 15px;
  border: 0;
  border-radius: 8px;
  background: #5865f2;
  color: white;
  font-weight: bold;
  cursor: pointer;
}

.green {
  background: #23a55a;
}

</style>

</head>

<body>

<header>

<strong>🤖 인증봇 관리자</strong>

<a href="/logout">
로그아웃
</a>

</header>

<div class="container">

<div class="status">

<h2>봇 상태</h2>

<p>
${client.isReady()
  ? '🟢 온라인'
  : '🔴 오프라인'}
</p>

<p>
서버 수: ${client.guilds.cache.size}
</p>

</div>

<h2>서버 관리</h2>

${guilds || '<p>봇이 들어가 있는 서버가 없습니다.</p>'}

</div>

</body>
</html>
  `);
});

// ========================================
// 설정 저장
// ========================================

app.post('/save', requireLogin, (req, res) => {

  const { guildId, roleId, channelId } = req.body;

  guildSettings.set(guildId, {
    roleId,
    channelId
  });

  res.redirect('/');
});

// ========================================
// 인증 패널 전송
// ========================================

app.post('/send-panel', requireLogin, async (req, res) => {

  const { guildId } = req.body;

  const settings = guildSettings.get(guildId);

  if (!settings || !settings.roleId || !settings.channelId) {
    return res.send(`
      <script>
        alert('먼저 인증 역할과 인증 채널을 설정해 주세요.');
        location.href='/';
      </script>
    `);
  }

  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return res.send(`
      <script>
        alert('서버를 찾을 수 없습니다.');
        location.href='/';
      </script>
    `);
  }

  const channel = guild.channels.cache.get(settings.channelId);

  if (!channel || !channel.isTextBased()) {
    return res.send(`
      <script>
        alert('인증 채널을 찾을 수 없습니다.');
        location.href='/';
      </script>
    `);
  }

  const embed = new EmbedBuilder()
    .setTitle('🔐 서버 인증')
    .setDescription(
      '서버 이용을 시작하시려면 아래 **인증하기** 버튼을 눌러주세요.\\n\\n' +
      '인증이 완료되면 자동으로 인증 역할이 지급됩니다.'
    )
    .setColor(0x5865F2)
    .setFooter({
      text: '인증봇'
    });

  const button = new ButtonBuilder()
    .setCustomId('verify')
    .setLabel('인증하기')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder()
    .addComponents(button);

  try {

    await channel.send({
      embeds: [embed],
      components: [row]
    });

    res.send(`
      <script>
        alert('인증 패널을 전송했습니다.');
        location.href='/';
      </script>
    `);

  } catch (error) {

    console.error(error);

    res.send(`
      <script>
        alert('인증 패널 전송에 실패했습니다.');
        location.href='/';
      </script>
    `);
  }
});

// ========================================
// 인증 버튼
// ========================================

client.on('interactionCreate', async interaction => {

  if (!interaction.isButton()) return;

  if (interaction.customId !== 'verify') return;

  const settings = guildSettings.get(
    interaction.guild.id
  );

  if (!settings || !settings.roleId) {
    return interaction.reply({
      content:
        '❌ 이 서버의 인증 역할이 설정되지 않았습니다.',
      ephemeral: true
    });
  }

  const role = interaction.guild.roles.cache.get(
    settings.roleId
  );

  if (!role) {
    return interaction.reply({
      content:
        '❌ 인증 역할을 찾을 수 없습니다. 서버 관리자에게 문의해 주세요.',
      ephemeral: true
    });
  }

  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({
      content: '✅ 이미 인증이 완료되었습니다.',
      ephemeral: true
    });
  }

  try {

    await interaction.member.roles.add(role);

    await interaction.reply({
      content:
        `✅ 인증이 완료되었습니다!\n${role} 역할이 지급되었습니다.`,
      ephemeral: true
    });

  } catch (error) {

    console.error(error);

    await interaction.reply({
      content:
        '❌ 역할 지급에 실패했습니다.\n' +
        '봇의 역할 위치와 역할 관리 권한을 확인해 주세요.',
      ephemeral: true
    });
  }
});

// ========================================
// HTML 특수문자 처리
// ========================================

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========================================
// 웹 서버
// ========================================

app.listen(PORT, () => {
  console.log(`웹 관리자 페이지 실행: ${PORT}`);
});
