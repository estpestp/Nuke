const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nuke_0930';
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'change-this-secret';

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 6
    }
  })
);

// ========================================
// 서버별 설정
// ========================================

const guildSettings = new Map();

// ========================================
// Discord 봇
// ========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ========================================
// 봇 상태
// ========================================

function getBotStatus() {
  return {
    online: client.isReady(),
    username: client.user?.tag || null,
    guildCount: client.guilds.cache.size
  };
}

function broadcastBotStatus() {
  io.emit('botStatus', getBotStatus());
}

// ========================================
// Discord 로그인 완료
// ========================================

client.once('ready', () => {
  console.log(`✅ Discord 로그인 완료: ${client.user.tag}`);

  console.log(
    `📡 현재 ${client.guilds.cache.size}개의 서버에 연결되어 있습니다.`
  );

  broadcastBotStatus();
});

// ========================================
// Discord 연결 상태
// ========================================

client.on('shardReady', () => {
  console.log('🟢 Discord 연결 준비 완료');

  broadcastBotStatus();
});

client.on('shardDisconnect', () => {
  console.log('🔴 Discord 연결 종료');

  io.emit('botStatus', {
    online: false,
    username: null,
    guildCount: 0
  });
});

client.on('shardResume', () => {
  console.log('🟢 Discord 연결 재개');

  broadcastBotStatus();
});

// ========================================
// Discord 메시지 수신
// ========================================

client.on('messageCreate', message => {
  if (!message.guild) return;

  console.log(
    `[${message.guild.name}] ${message.author.username}: ${message.content}`
  );

  io.emit('discordMessage', {
    guildId: message.guild.id,
    guildName: message.guild.name,
    channelId: message.channel.id,
    channelName: message.channel.name,
    author: message.author.username,
    authorAvatar: message.author.displayAvatarURL(),
    content: message.content,
    bot: message.author.bot,
    timestamp: Date.now()
  });
});

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

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>인증봇 로그인</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;

  background: #0f1117;
  color: white;

  font-family: Arial, sans-serif;

  display: flex;
  align-items: center;
  justify-content: center;
}

.login {
  width: 350px;

  background: #181b23;

  padding: 30px;

  border-radius: 18px;

  box-shadow:
    0 15px 50px rgba(0,0,0,.4);
}

h1 {
  margin-top: 0;
}

input {
  width: 100%;

  padding: 14px;

  margin: 15px 0;

  background: #0f1117;

  color: white;

  border: 1px solid #343846;

  border-radius: 9px;
}

button {
  width: 100%;

  padding: 14px;

  background: #5865f2;

  color: white;

  border: 0;

  border-radius: 9px;

  cursor: pointer;

  font-weight: bold;
}

</style>

</head>

<body>

<div class="login">

<h1>🤖 인증봇</h1>

<p>관리자 패널에 로그인하세요.</p>

<form method="POST" action="/login">

<input
type="password"
name="password"
placeholder="비밀번호"
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

    const settings =
      guildSettings.get(guild.id) || {};

    const roles =
      guild.roles.cache
        .filter(role => role.id !== guild.id)
        .map(role => `
<option
value="${role.id}"
${settings.roleId === role.id ? 'selected' : ''}
>
${escapeHtml(role.name)}
</option>
        `)
        .join('');

    const channels =
      guild.channels.cache
        .filter(channel => channel.isTextBased())
        .map(channel => `
<option
value="${channel.id}"
${settings.channelId === channel.id ? 'selected' : ''}
>
# ${escapeHtml(channel.name)}
</option>
        `)
        .join('');

    return `

<div class="server">

<h2>
🏠 ${escapeHtml(guild.name)}
</h2>

<form method="POST" action="/save">

<input
type="hidden"
name="guildId"
value="${guild.id}"
>

<label>
인증 역할
</label>

<select name="roleId">

<option value="">
역할 선택
</option>

${roles}

</select>

<label>
인증 채널
</label>

<select name="channelId">

<option value="">
채널 선택
</option>

${channels}

</select>

<button type="submit">
설정 저장
</button>

</form>

<form
method="POST"
action="/send-panel"
>

<input
type="hidden"
name="guildId"
value="${guild.id}"
>

<button
class="green"
type="submit"
>
🔐 인증 패널 전송
</button>

</form>

<hr>

<h3>
💬 채팅
</h3>

<label>
채팅 채널
</label>

<select
id="chatChannel-${guild.id}"
onchange="selectChannel('${guild.id}')"
>

<option value="">
채널 선택
</option>

${channels}

</select>

<div
class="chat"
id="chat-${guild.id}"
>

<div class="empty">
채널을 선택해 주세요.
</div>

</div>

<div class="send">

<input
id="message-${guild.id}"
placeholder="메시지를 입력하세요..."
onkeydown="handleEnter(event,'${guild.id}')"
>

<button
onclick="sendMessage('${guild.id}')"
>
전송
</button>

</div>

</div>

`;

  }).join('');

  const status = getBotStatus();

  res.send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>인증봇 관리자</title>

<script src="/socket.io/socket.io.js"></script>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;

  background: #0f1117;
  color: white;

  font-family: Arial, sans-serif;
}

header {
  background: #181b23;

  padding: 18px 25px;

  display: flex;

  justify-content: space-between;

  align-items: center;
}

header a {
  color: #aaa;

  text-decoration: none;
}

.container {
  max-width: 1000px;

  margin: auto;

  padding: 25px;
}

.status {
  background: #181b23;

  padding: 20px;

  border-radius: 14px;

  margin-bottom: 20px;
}

.server {
  background: #181b23;

  padding: 22px;

  border-radius: 14px;

  margin-bottom: 25px;
}

label {
  display: block;

  margin-top: 14px;

  margin-bottom: 6px;
}

select,
.send input {
  width: 100%;

  padding: 12px;

  background: #0f1117;

  color: white;

  border: 1px solid #343846;

  border-radius: 8px;
}

button {
  padding: 12px;

  margin-top: 12px;

  border: 0;

  border-radius: 8px;

  background: #5865f2;

  color: white;

  font-weight: bold;

  cursor: pointer;
}

.green {
  background: #23a55a;

  width: 100%;
}

.chat {
  height: 350px;

  overflow-y: auto;

  background: #0d0f14;

  border-radius: 10px;

  padding: 12px;

  margin-top: 10px;
}

.message {
  margin-bottom: 12px;
}

.author {
  font-weight: bold;

  color: #8ea1ff;
}

.time {
  font-size: 11px;

  color: #777;

  margin-left: 5px;
}

.content {
  margin-top: 3px;

  word-break: break-word;
}

.empty {
  color: #777;

  text-align: center;

  margin-top: 130px;
}

.send {
  display: flex;

  gap: 8px;

  margin-top: 8px;
}

.send input {
  flex: 1;
}

.send button {
  width: 80px;

  margin-top: 0;
}

hr {
  border: 0;

  border-top: 1px solid #30333d;

  margin: 25px 0;
}

</style>

</head>

<body>

<header>

<strong>
🤖 인증봇 관리자
</strong>

<a href="/logout">
로그아웃
</a>

</header>

<div class="container">

<div class="status">

<h2>
봇 상태
</h2>

<p id="botStatus">

${
  status.online
    ? '🟢 온라인'
    : '🔴 오프라인'
}

</p>

<p id="botName">

${
  status.username
    ? escapeHtml(status.username)
    : ''
}

</p>

<p id="guildCount">

서버 수: ${status.guildCount}

</p>

</div>

<h2>
서버 관리
</h2>

${guilds || '<p>봇이 들어가 있는 서버가 없습니다.</p>'}

</div>

<script>

const socket = io();

const selectedChannels = {};

// ========================================
// 실시간 봇 상태
// ========================================

socket.on('botStatus', data => {

  const status =
    document.getElementById(
      'botStatus'
    );

  const name =
    document.getElementById(
      'botName'
    );

  const count =
    document.getElementById(
      'guildCount'
    );

  if (!status) return;

  if (data.online) {

    status.textContent =
      '🟢 온라인';

    name.textContent =
      data.username || '';

    count.textContent =
      '서버 수: ' +
      (data.guildCount || 0);

  } else {

    status.textContent =
      '🔴 오프라인';

    name.textContent =
      '';

    count.textContent =
      '서버 수: 0';

  }

});

// ========================================
// 채널 선택
// ========================================

function selectChannel(guildId) {

  const select =
    document.getElementById(
      'chatChannel-' + guildId
    );

  selectedChannels[guildId] =
    select.value;

  const chat =
    document.getElementById(
      'chat-' + guildId
    );

  chat.innerHTML =
    '<div class="empty">' +
    '새로운 메시지를 기다리는 중입니다.' +
    '</div>';

}

// ========================================
// Discord 메시지 수신
// ========================================

socket.on(
  'discordMessage',
  data => {

    if (
      !selectedChannels[data.guildId]
    ) {
      return;
    }

    if (
      selectedChannels[data.guildId] !==
      data.channelId
    ) {
      return;
    }

    addMessage(data);

  }
);

// ========================================
// 메시지 화면 추가
// ========================================

function addMessage(data) {

  const chat =
    document.getElementById(
      'chat-' + data.guildId
    );

  if (!chat) return;

  const empty =
    chat.querySelector('.empty');

  if (empty) {
    empty.remove();
  }

  const message =
    document.createElement(
      'div'
    );

  message.className =
    'message';

  const author =
    document.createElement(
      'span'
    );

  author.className =
    'author';

  author.textContent =
    data.author;

  const time =
    document.createElement(
      'span'
    );

  time.className =
    'time';

  time.textContent =
    new Date(
      data.timestamp
    ).toLocaleTimeString();

  const content =
    document.createElement(
      'div'
    );

  content.className =
    'content';

  content.textContent =
    data.content;

  message.appendChild(author);
  message.appendChild(time);
  message.appendChild(content);

  chat.appendChild(message);

  chat.scrollTop =
    chat.scrollHeight;
}

// ========================================
// 웹 → Discord 메시지
// ========================================

async function sendMessage(guildId) {

  const channelId =
    selectedChannels[guildId];

  const input =
    document.getElementById(
      'message-' + guildId
    );

  const content =
    input.value.trim();

  if (!channelId) {

    alert(
      '채팅 채널을 먼저 선택해 주세요.'
    );

    return;
  }

  if (!content) return;

  const response =
    await fetch(
      '/api/send-message',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          guildId,
          channelId,
          content
        })
      }
    );

  const result =
    await response.json();

  if (!result.ok) {

    alert(
      result.error ||
      '메시지 전송에 실패했습니다.'
    );

    return;
  }

  input.value = '';
}

// ========================================
// Enter 전송
// ========================================

function handleEnter(
  event,
  guildId
) {

  if (event.key === 'Enter') {

    event.preventDefault();

    sendMessage(guildId);

  }

}

</script>

</body>

</html>

  `);
});

// ========================================
// 서버 설정 저장
// ========================================

app.post(
  '/save',
  requireLogin,
  (req, res) => {

    const {
      guildId,
      roleId,
      channelId
    } = req.body;

    guildSettings.set(
      guildId,
      {
        roleId,
        channelId
      }
    );

    res.redirect('/');

  }
);

// ========================================
// 인증 패널 전송
// ========================================

app.post(
  '/send-panel',
  requireLogin,
  async (req, res) => {

    const { guildId } =
      req.body;

    const settings =
      guildSettings.get(guildId);

    if (
      !settings ||
      !settings.roleId ||
      !settings.channelId
    ) {

      return res.send(`
<script>

alert(
'먼저 인증 역할과 인증 채널을 설정해 주세요.'
);

location.href='/';

</script>
      `);

    }

    const guild =
      client.guilds.cache.get(
        guildId
      );

    if (!guild) {

      return res.send(`
<script>

alert(
'서버를 찾을 수 없습니다.'
);

location.href='/';

</script>
      `);

    }

    const channel =
      guild.channels.cache.get(
        settings.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {

      return res.send(`
<script>

alert(
'인증 채널을 찾을 수 없습니다.'
);

location.href='/';

</script>
      `);

    }

    const embed =
      new EmbedBuilder()

        .setTitle(
          '🔐 서버 인증'
        )

        .setDescription(
          '서버 이용을 시작하시려면 아래 **인증하기** 버튼을 눌러주세요.\n\n' +
          '인증이 완료되면 자동으로 인증 역할이 지급됩니다.'
        )

        .setColor(0x5865F2)

        .setFooter({
          text: '인증봇'
        });

    const button =
      new ButtonBuilder()

        .setCustomId(
          'verify'
        )

        .setLabel(
          '인증하기'
        )

        .setEmoji(
          '✅'
        )

        .setStyle(
          ButtonStyle.Success
        );

    const row =
      new ActionRowBuilder()
        .addComponents(
          button
        );

    try {

      await channel.send({
        embeds: [embed],
        components: [row]
      });

      res.send(`
<script>

alert(
'인증 패널을 전송했습니다.'
);

location.href='/';

</script>
      `);

    } catch (error) {

      console.error(
        error
      );

      res.send(`
<script>

alert(
'인증 패널 전송에 실패했습니다.'
);

location.href='/';

</script>
      `);

    }

  }
);

// ========================================
// 웹 → Discord 메시지
// ========================================

app.post(
  '/api/send-message',
  requireLogin,
  async (req, res) => {

    const {
      guildId,
      channelId,
      content
    } = req.body;

    if (
      typeof content !== 'string' ||
      !content.trim()
    ) {

      return res.json({
        ok: false,
        error:
          '메시지를 입력해 주세요.'
      });

    }

    if (content.length > 2000) {

      return res.json({
        ok: false,
        error:
          'Discord 메시지는 2000자를 초과할 수 없습니다.'
      });

    }

    const guild =
      client.guilds.cache.get(
        guildId
      );

    if (!guild) {

      return res.json({
        ok: false,
        error:
          '서버를 찾을 수 없습니다.'
      });

    }

    const channel =
      guild.channels.cache.get(
        channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {

      return res.json({
        ok: false,
        error:
          '채널을 찾을 수 없습니다.'
      });

    }

    try {

      await channel.send({
        content:
          content.trim()
      });

      return res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        '메시지 전송 오류:',
        error
      );

      return res.json({
        ok: false,
        error:
          'Discord에 메시지를 전송하지 못했습니다.'
      });

    }

  }
);

// ========================================
// 인증 버튼
// ========================================

client.on(
  'interactionCreate',
  async interaction => {

    if (!interaction.isButton()) {
      return;
    }

    if (
      interaction.customId !==
      'verify'
    ) {
      return;
    }

    const settings =
      guildSettings.get(
        interaction.guild.id
      );

    if (
      !settings ||
      !settings.roleId
    ) {

      return interaction.reply({
        content:
          '❌ 이 서버의 인증 역할이 설정되지 않았습니다.',
        ephemeral: true
      });

    }

    const role =
      interaction.guild.roles.cache.get(
        settings.roleId
      );

    if (!role) {

      return interaction.reply({
        content:
          '❌ 인증 역할을 찾을 수 없습니다. 서버 관리자에게 문의해 주세요.',
        ephemeral: true
      });

    }

    if (
      interaction.member.roles.cache.has(
        role.id
      )
    ) {

      return interaction.reply({
        content:
          '✅ 이미 인증이 완료되었습니다.',
        ephemeral: true
      });

    }

    try {

      await interaction.member.roles.add(
        role
      );

      await interaction.reply({
        content:
          `✅ 인증이 완료되었습니다!\n${role} 역할이 지급되었습니다.`,
        ephemeral: true
      });

    } catch (error) {

      console.error(
        error
      );

      await interaction.reply({
        content:
          '❌ 역할 지급에 실패했습니다.\n' +
          '봇의 역할 위치와 역할 관리 권한을 확인해 주세요.',
        ephemeral: true
      });

    }

  }
);

// ========================================
// HTML 보안 처리
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
// 웹 서버 실행
// ========================================

server.listen(
  PORT,
  () => {

    console.log(
      `🌐 웹 관리자 페이지 실행: ${PORT}`
    );

  }
);

// ========================================
// Discord 봇 로그인
// ========================================

console.log('🔄 Discord 로그인 시도 중...');

client.login(TOKEN)
  .then(() => {
    console.log('🔑 Discord 로그인 요청 완료');
  })
  .catch(error => {

    console.error(
      '❌ Discord 로그인 실패:',
      error
    );

  });
