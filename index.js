const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const crypto = require('crypto');

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

const CLIENT_ID =
  process.env.DISCORD_CLIENT_ID;

const CLIENT_SECRET =
  process.env.DISCORD_CLIENT_SECRET;

const REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ||
  'https://nuke-iukw.onrender.com/auth/discord/callback';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  'nuke_0930';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'change-this-secret';

const DATABASE_URL =
  process.env.DATABASE_URL;

const DISCORD_API =
  'https://discord.com/api/v10';


// ========================================
// 필수 환경변수 확인
// ========================================

if (!TOKEN) {
  console.error(
    '❌ DISCORD_TOKEN 환경변수가 없습니다.'
  );

  process.exit(1);
}

if (!CLIENT_ID) {
  console.error(
    '❌ DISCORD_CLIENT_ID 환경변수가 없습니다.'
  );

  process.exit(1);
}

if (!CLIENT_SECRET) {
  console.error(
    '❌ DISCORD_CLIENT_SECRET 환경변수가 없습니다.'
  );

  process.exit(1);
}

if (!DATABASE_URL) {
  console.error(
    '❌ DATABASE_URL 환경변수가 없습니다.'
  );

  process.exit(1);
}


// ========================================
// PostgreSQL
// ========================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// ========================================
// DB 초기화
// ========================================

async function initDatabase() {

  await pool.query(`

    CREATE TABLE IF NOT EXISTS app_users (

      discord_user_id VARCHAR(32)
      PRIMARY KEY,

      username TEXT,

      global_name TEXT,

      avatar TEXT,

      access_token TEXT,

      expires_at BIGINT,

      scope TEXT,

      installed_at TIMESTAMPTZ
      DEFAULT NOW(),

      updated_at TIMESTAMPTZ
      DEFAULT NOW()

    );

  `);

  console.log(
    '✅ PostgreSQL 데이터베이스 준비 완료'
  );
}


// ========================================
// Express
// ========================================

app.set(
  'trust proxy',
  1
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.json()
);

app.use(
  session({

    secret: SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {

      httpOnly: true,

      secure:
        process.env.NODE_ENV ===
        'production',

      sameSite: 'lax',

      maxAge:
        1000 *
        60 *
        60 *
        6

    }

  })
);


// ========================================
// 서버별 설정
// ========================================

const guildSettings =
  new Map();


// ========================================
// Discord 봇
// ========================================

const client =
  new Client({

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

    online:
      client.isReady(),

    username:
      client.user?.tag ||
      null,

    guildCount:
      client.guilds.cache.size

  };

}


function broadcastBotStatus() {

  io.emit(
    'botStatus',
    getBotStatus()
  );

}


// ========================================
// Discord 로그인 완료
// ========================================

client.once(
  'ready',
  () => {

    console.log(
      `✅ Discord 로그인 완료: ${client.user.tag}`
    );

    console.log(
      `📡 현재 ${client.guilds.cache.size}개의 서버에 연결되어 있습니다.`
    );

    broadcastBotStatus();

  }
);


// ========================================
// Discord 연결 상태
// ========================================

client.on(
  'shardReady',
  () => {

    console.log(
      '🟢 Discord 연결 준비 완료'
    );

    broadcastBotStatus();

  }
);


client.on(
  'shardDisconnect',
  () => {

    console.log(
      '🔴 Discord 연결 종료'
    );

    io.emit(
      'botStatus',
      {

        online: false,

        username: null,

        guildCount: 0

      }
    );

  }
);


client.on(
  'shardResume',
  () => {

    console.log(
      '🟢 Discord 연결 재개'
    );

    broadcastBotStatus();

  }
);


// ========================================
// Discord 메시지 수신
// ========================================

client.on(
  'messageCreate',
  message => {

    if (!message.guild) {
      return;
    }

    console.log(
      `[${message.guild.name}] ${message.author.username}: ${message.content}`
    );

    io.emit(
      'discordMessage',
      {

        guildId:
          message.guild.id,

        guildName:
          message.guild.name,

        channelId:
          message.channel.id,

        channelName:
          message.channel.name,

        author:
          message.author.username,

        authorAvatar:
          message.author.displayAvatarURL(),

        content:
          message.content,

        bot:
          message.author.bot,

        timestamp:
          Date.now()

      }
    );

  }
);


// ========================================
// 관리자 로그인 확인
// ========================================

function requireLogin(
  req,
  res,
  next
) {

  if (!req.session.loggedIn) {

    return res.redirect(
      '/login'
    );

  }

  next();

}


// ========================================
// OAuth URL 생성
// ========================================

function createDiscordOAuthURL(
  guildId
) {

  const state =
    crypto.randomBytes(32)
      .toString('hex');

  return {
    state,

    url:
      'https://discord.com/oauth2/authorize?' +

      new URLSearchParams({

        client_id:
          CLIENT_ID,

        response_type:
          'code',

        redirect_uri:
          REDIRECT_URI,

        scope:
          'identify guilds.join',

        state,

        prompt:
          'consent'

      }).toString()

  };

}


// ========================================
// Discord API 요청
// ========================================

async function discordFetch(
  endpoint,
  options = {}
) {

  const response =
    await fetch(
      DISCORD_API + endpoint,
      {

        ...options,

        headers: {

          'Content-Type':
            'application/json',

          ...(options.headers || {})

        }

      }
    );

  const text =
    await response.text();

  let data;

  try {

    data =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    data =
      text;

  }

  return {

    response,

    data

  };

}


// ========================================
// OAuth 토큰 교환
// ========================================

async function exchangeCode(
  code
) {

  const body =
    new URLSearchParams({

      client_id:
        CLIENT_ID,

      client_secret:
        CLIENT_SECRET,

      grant_type:
        'authorization_code',

      code,

      redirect_uri:
        REDIRECT_URI

    });

  const response =
    await fetch(
      `${DISCORD_API}/oauth2/token`,
      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/x-www-form-urlencoded'

        },

        body

      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    throw new Error(
      data?.error_description ||
      data?.message ||
      'OAuth 토큰 교환 실패'
    );

  }

  return data;

}


// ========================================
// OAuth 사용자 정보
// ========================================

async function getDiscordUser(
  accessToken
) {

  const {
    response,
    data
  } =
    await discordFetch(
      '/users/@me',
      {

        headers: {

          Authorization:
            `Bearer ${accessToken}`

        }

      }
    );

  if (!response.ok) {

    throw new Error(
      data?.message ||
      'Discord 사용자 정보를 가져오지 못했습니다.'
    );

  }

  return data;

}


// ========================================
// OAuth 사용자 DB 저장
// ========================================

async function saveAppUser(
  user,
  tokenData
) {

  const expiresAt =
    Date.now() +
    (
      Number(
        tokenData.expires_in ||
        604800
      ) *
      1000
    );

  await pool.query(

    `

    INSERT INTO app_users (

      discord_user_id,

      username,

      global_name,

      avatar,

      access_token,

      expires_at,

      scope,

      updated_at

    )

    VALUES (

      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      NOW()

    )

    ON CONFLICT (
      discord_user_id
    )

    DO UPDATE SET

      username =
        EXCLUDED.username,

      global_name =
        EXCLUDED.global_name,

      avatar =
        EXCLUDED.avatar,

      access_token =
        EXCLUDED.access_token,

      expires_at =
        EXCLUDED.expires_at,

      scope =
        EXCLUDED.scope,

      updated_at =
        NOW()

    `,

    [

      user.id,

      user.username,

      user.global_name ||
        null,

      user.avatar ||
        null,

      tokenData.access_token,

      expiresAt,

      tokenData.scope ||
        ''

    ]

  );

}


// ========================================
// 저장된 사용자 가져오기
// ========================================

async function getAppUsers() {

  const result =
    await pool.query(

      `

      SELECT

        discord_user_id,

        username,

        global_name,

        avatar,

        expires_at,

        scope,

        installed_at,

        updated_at

      FROM app_users

      ORDER BY updated_at DESC

      `

    );

  return result.rows;

}


// ========================================
// 사용자 OAuth 토큰 가져오기
// ========================================

async function getUserToken(
  userId
) {

  const result =
    await pool.query(

      `

      SELECT

        access_token,

        expires_at,

        scope

      FROM app_users

      WHERE discord_user_id = $1

      `,

      [userId]

    );

  if (
    result.rows.length === 0
  ) {

    return null;

  }

  const row =
    result.rows[0];

  if (
    !row.access_token
  ) {

    return null;

  }

  if (
    row.expires_at &&
    Number(row.expires_at) <
      Date.now()
  ) {

    return null;

  }

  return row.access_token;

}


// ========================================
// 사용자 서버 참가
// ========================================

async function addUserToGuild(
  guildId,
  userId,
  accessToken,
  roleId
) {

  const body = {

    access_token:
      accessToken

  };

  if (roleId) {

    body.roles = [
      roleId
    ];

  }

  const {
    response,
    data
  } =
    await discordFetch(

      `/guilds/${guildId}/members/${userId}`,

      {

        method:
          'PUT',

        headers: {

          Authorization:
            `Bot ${TOKEN}`

        },

        body:
          JSON.stringify(body)

      }

    );

  return {

    ok:
      response.ok ||
      response.status === 201 ||
      response.status === 204,

    status:
      response.status,

    data

  };

}


// ========================================
// 로그인 페이지
// ========================================

app.get(
  '/login',
  (req, res) => {

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

  font-family:
    Arial,
    sans-serif;

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
    0 15px 50px
    rgba(0,0,0,.4);

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

<p>
관리자 패널에 로그인하세요.
</p>

<form
method="POST"
action="/login"
>

<input
type="password"
name="password"
placeholder="비밀번호"
required
>

<button
type="submit"
>
로그인
</button>

</form>

</div>

</body>

</html>

    `);

  }
);


// ========================================
// 로그인 처리
// ========================================

app.post(
  '/login',
  (req, res) => {

    if (
      req.body.password !==
      ADMIN_PASSWORD
    ) {

      return res.send(`

<script>

alert(
'비밀번호가 올바르지 않습니다.'
);

location.href =
'/login';

</script>

      `);

    }

    req.session.loggedIn =
      true;

    res.redirect('/');

  }
);


// ========================================
// 로그아웃
// ========================================

app.get(
  '/logout',
  (req, res) => {

    req.session.destroy(
      () => {

        res.redirect(
          '/login'
        );

      }
    );

  }
);


// ========================================
// 관리자 페이지
// ========================================

app.get(
  '/',
  requireLogin,
  async (req, res) => {

    const guilds =
      client.guilds.cache.map(
        guild => {

          const settings =
            guildSettings.get(
              guild.id
            ) || {};

          const roles =
            guild.roles.cache

              .filter(
                role =>
                  role.id !== guild.id
              )

              .map(
                role => `

<option
value="${role.id}"
${
  settings.roleId === role.id
    ? 'selected'
    : ''
}
>
${escapeHtml(role.name)}
</option>

                `
              )

              .join('');

          const channels =
            guild.channels.cache

              .filter(
                channel =>
                  channel.isTextBased()
              )

              .map(
                channel => `

<option
value="${channel.id}"
${
  settings.channelId === channel.id
    ? 'selected'
    : ''
}
>
# ${escapeHtml(channel.name)}
</option>

                `
              )

              .join('');

          return `

<div class="server">

<h2>
🏠 ${escapeHtml(guild.name)}
</h2>

<form
method="POST"
action="/save"
>

<input
type="hidden"
name="guildId"
value="${guild.id}"
>

<label>
인증 역할
</label>

<select
name="roleId"
>

<option value="">
역할 선택
</option>

${roles}

</select>

<label>
인증 채널
</label>

<select
name="channelId"
>

<option value="">
채널 선택
</option>

${channels}

</select>

<button
type="submit"
>
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


<button
class="purple"
onclick="openInvite('${guild.id}')"
>
👥 해당 서버에 사람들을 초대하기
</button>


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

        }

      ).join('');


    const status =
      getBotStatus();


    res.send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>
인증봇 관리자
</title>

<script
src="/socket.io/socket.io.js"
></script>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  background: #0f1117;

  color: white;

  font-family:
    Arial,
    sans-serif;

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

.purple {

  background: #8b5cf6;

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

  border-top:
    1px solid #30333d;

  margin: 25px 0;

}


/* ===================================
   초대 모달
=================================== */

.modal {

  display: none;

  position: fixed;

  inset: 0;

  background:
    rgba(0,0,0,.7);

  z-index: 9999;

  align-items: center;

  justify-content: center;

}

.modal-box {

  width: min(
    650px,
    92vw
  );

  max-height: 80vh;

  overflow-y: auto;

  background: #181b23;

  border-radius: 16px;

  padding: 24px;

  box-shadow:
    0 20px 70px
    rgba(0,0,0,.6);

}

.modal-header {

  display: flex;

  justify-content:
    space-between;

  align-items: center;

}

.close {

  background: #30333d;

  width: 40px;

  height: 40px;

  padding: 0;

  margin: 0;

  font-size: 18px;

}

.user-list {

  margin-top: 15px;

}

.user {

  display: flex;

  align-items: center;

  gap: 12px;

  padding: 10px;

  background: #101219;

  border-radius: 10px;

  margin-bottom: 8px;

}

.user:hover {

  background: #20232d;

}

.user img {

  width: 40px;

  height: 40px;

  border-radius: 50%;

}

.user-info {

  flex: 1;

}

.user-name {

  font-weight: bold;

}

.user-id {

  color: #777;

  font-size: 11px;

}

.user input {

  width: 20px;

  height: 20px;

}

.invite-actions {

  display: flex;

  gap: 8px;

}

.invite-actions button {

  flex: 1;

}

.select-all {

  background: #30333d;

}

#inviteResult {

  margin-top: 12px;

  color: #aaa;

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
    ? escapeHtml(
        status.username
      )
    : ''
}

</p>

<p id="guildCount">

서버 수:
${status.guildCount}

</p>

</div>


<h2>
서버 관리
</h2>


${
  guilds ||
  '<p>봇이 들어가 있는 서버가 없습니다.</p>'
}


</div>


<!-- ===================================
     초대 모달
=================================== -->

<div
class="modal"
id="inviteModal"
>

<div class="modal-box">

<div class="modal-header">

<h2>
👥 서버에 사람들 초대
</h2>

<button
class="close"
onclick="closeInvite()"
>
×
</button>

</div>


<p>
앱 설치 및 서버 참가 권한을 승인한 사용자입니다.
</p>


<div
class="invite-actions"
>

<button
class="select-all"
onclick="selectAllUsers()"
>
전체 선택
</button>

<button
class="select-all"
onclick="unselectAllUsers()"
>
전체 해제
</button>

</div>


<div
id="userList"
class="user-list"
>

<div class="empty">
사용자 목록을 불러오는 중...
</div>

</div>


<div
id="inviteResult"
></div>


<button
onclick="inviteSelected()"
style="width:100%;"
>
🚀 선택한 사용자 서버에 참가시키기
</button>


</div>

</div>


<script>

const socket =
  io();


const selectedChannels =
  {};


let inviteGuildId =
  null;


// ========================================
// 봇 상태
// ========================================

socket.on(
  'botStatus',
  data => {

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

    if (!status) {
      return;
    }

    if (data.online) {

      status.textContent =
        '🟢 온라인';

      name.textContent =
        data.username ||
        '';

      count.textContent =
        '서버 수: ' +
        (
          data.guildCount ||
          0
        );

    } else {

      status.textContent =
        '🔴 오프라인';

      name.textContent =
        '';

      count.textContent =
        '서버 수: 0';

    }

  }
);


// ========================================
// 채널 선택
// ========================================

function selectChannel(
  guildId
) {

  const select =
    document.getElementById(
      'chatChannel-' +
      guildId
    );

  selectedChannels[guildId] =
    select.value;


  const chat =
    document.getElementById(
      'chat-' +
      guildId
    );


  chat.innerHTML =
    '<div class="empty">' +
    '새로운 메시지를 기다리는 중입니다.' +
    '</div>';

}


// ========================================
// Discord 메시지
// ========================================

socket.on(
  'discordMessage',
  data => {

    if (
      !selectedChannels[
        data.guildId
      ]
    ) {

      return;

    }


    if (
      selectedChannels[
        data.guildId
      ] !==
      data.channelId
    ) {

      return;

    }


    addMessage(data);

  }
);


// ========================================
// 메시지 추가
// ========================================

function addMessage(
  data
) {

  const chat =
    document.getElementById(
      'chat-' +
      data.guildId
    );


  if (!chat) {
    return;
  }


  const empty =
    chat.querySelector(
      '.empty'
    );


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


  message.appendChild(
    author
  );

  message.appendChild(
    time
  );

  message.appendChild(
    content
  );


  chat.appendChild(
    message
  );


  chat.scrollTop =
    chat.scrollHeight;

}


// ========================================
// 웹 → Discord
// ========================================

async function sendMessage(
  guildId
) {

  const channelId =
    selectedChannels[
      guildId
    ];


  const input =
    document.getElementById(
      'message-' +
      guildId
    );


  const content =
    input.value.trim();


  if (!channelId) {

    alert(
      '채팅 채널을 먼저 선택해 주세요.'
    );

    return;

  }


  if (!content) {
    return;
  }


  const response =
    await fetch(
      '/api/send-message',
      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify({

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


  input.value =
    '';

}


// ========================================
// Enter
// ========================================

function handleEnter(
  event,
  guildId
) {

  if (
    event.key ===
    'Enter'
  ) {

    event.preventDefault();

    sendMessage(
      guildId
    );

  }

}


// ========================================
// 초대 모달 열기
// ========================================

async function openInvite(
  guildId
) {

  inviteGuildId =
    guildId;


  const modal =
    document.getElementById(
      'inviteModal'
    );


  modal.style.display =
    'flex';


  const list =
    document.getElementById(
      'userList'
    );


  list.innerHTML =
    '<div class="empty">' +
    '사용자 목록을 불러오는 중...' +
    '</div>';


  document.getElementById(
    'inviteResult'
  ).textContent =
    '';


  try {

    const response =
      await fetch(
        '/api/app-users'
      );


    const result =
      await response.json();


    if (!result.ok) {

      throw new Error(
        result.error ||
        '사용자 목록을 가져오지 못했습니다.'
      );

    }


    if (
      !result.users.length
    ) {

      list.innerHTML =
        '<div class="empty">' +
        '아직 앱을 설치하고 권한을 승인한 사용자가 없습니다.' +
        '</div>';

      return;

    }


    list.innerHTML =
      result.users
        .map(
          user => `

<div class="user">

<input
type="checkbox"
class="invite-user"
value="${user.discord_user_id}"
>

${
  user.avatar
    ? `

<img
src="https://cdn.discordapp.com/avatars/${user.discord_user_id}/${user.avatar}.png?size=128"
>

`
    : `

<div
style="
width:40px;
height:40px;
border-radius:50%;
background:#5865f2;
display:flex;
align-items:center;
justify-content:center;
"
>
👤
</div>

`
}

<div class="user-info">

<div class="user-name">

${escapeClient(
  user.global_name ||
  user.username
)}

</div>

<div class="user-id">

${escapeClient(
  user.username
)}

</div>

</div>

</div>

          `
        )
        .join('');


  } catch (error) {

    list.innerHTML =
      '<div class="empty">' +
      escapeClient(
        error.message
      ) +
      '</div>';

  }

}


// ========================================
// 초대 모달 닫기
// ========================================

function closeInvite() {

  document.getElementById(
    'inviteModal'
  ).style.display =
    'none';

  inviteGuildId =
    null;

}


// ========================================
// 전체 선택
// ========================================

function selectAllUsers() {

  document
    .querySelectorAll(
      '.invite-user'
    )
    .forEach(
      checkbox => {

        checkbox.checked =
          true;

      }
    );

}


// ========================================
// 전체 해제
// ========================================

function unselectAllUsers() {

  document
    .querySelectorAll(
      '.invite-user'
    )
    .forEach(
      checkbox => {

        checkbox.checked =
          false;

      }
    );

}


// ========================================
// 선택 사용자 초대
// ========================================

async function inviteSelected() {

  if (!inviteGuildId) {

    alert(
      '서버를 선택해 주세요.'
    );

    return;

  }


  const userIds =
    Array.from(
      document.querySelectorAll(
        '.invite-user:checked'
      )
    )
    .map(
      checkbox =>
        checkbox.value
    );


  if (!userIds.length) {

    alert(
      '초대할 사용자를 선택해 주세요.'
    );

    return;

  }


  const resultBox =
    document.getElementById(
      'inviteResult'
    );


  resultBox.textContent =
    '⏳ 서버 참가 처리 중...';


  try {

    const response =
      await fetch(
        '/api/invite-app-users',
        {

          method:
            'POST',

          headers: {

            'Content-Type':
              'application/json'

          },

          body:
            JSON.stringify({

              guildId:
                inviteGuildId,

              userIds

            })

        }
      );


    const result =
      await response.json();


    if (!result.ok) {

      resultBox.textContent =
        '❌ ' +
        (
          result.error ||
          '처리에 실패했습니다.'
        );

      return;

    }


    const success =
      result.results
        .filter(
          item =>
            item.ok
        )
        .length;


    const failed =
      result.results
        .filter(
          item =>
            !item.ok
        )
        .length;


    resultBox.textContent =
      `✅ 완료: ${success}명 / 실패: ${failed}명`;

  } catch (error) {

    resultBox.textContent =
      '❌ 요청 중 오류가 발생했습니다.';

  }

}


// ========================================
// 브라우저용 HTML escape
// ========================================

function escapeClient(
  text
) {

  return String(text || '')
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );

}

</script>

</body>

</html>

    `);

  }
);


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
    } =
      req.body;


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

    const {
      guildId
    } =
      req.body;


    const settings =
      guildSettings.get(
        guildId
      );


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

location.href =
'/';

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

location.href =
'/';

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

location.href =
'/';

</script>

      `);

    }


    const embed =
      new EmbedBuilder()

        .setTitle(
          '🔐 서버 인증'
        )

        .setDescription(

          '서버 이용을 시작하시려면 아래 **인증하기** 버튼을 눌러주세요.\\n\\n' +

          '인증 과정에서 Discord 앱 설치 및 서버 참가 권한을 요청합니다.\\n\\n' +

          '권한 승인 후 자동으로 서버 참가 및 인증 역할 지급이 진행됩니다.'

        )

        .setColor(
          0x5865F2
        )

        .setFooter({
          text:
            '인증봇'
        });


    /*
     * 중요:
     *
     * 기존 customId 버튼 대신
     * URL 버튼을 사용한다.
     *
     * 사용자가 버튼을 누르면
     * Discord OAuth2 승인 페이지로 이동한다.
     *
     * guildId는 OAuth state에 저장한다.
     */


    const oauth =
      createDiscordOAuthURL(
        guildId
      );


    const button =
      new ButtonBuilder()

        .setLabel(
          '인증하기'
        )

        .setEmoji(
          '✅'
        )

        .setStyle(
          ButtonStyle.Link
        )

        .setURL(
          oauth.url
        );


    const row =
      new ActionRowBuilder()
        .addComponents(
          button
        );


    try {

      await channel.send({

        embeds: [
          embed
        ],

        components: [
          row
        ]

      });


      /*
       * OAuth state를 DB에 저장하지 않고
       * URL에 암호학적으로 충분히 랜덤한
       * state를 넣는다.
       *
       * callback에서는 state 안의 guildId를
       * 직접 복원하지 않고 별도 signed state를
       * 사용해야 한다.
       *
       * 따라서 아래에서는 OAuth state를
       * DB에 저장한다.
       */

      await saveOAuthState(
        oauth.state,
        guildId
      );


      res.send(`

<script>

alert(
'인증 패널을 전송했습니다.'
);

location.href =
'/';

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

location.href =
'/';

</script>

      `);

    }

  }
);


// ========================================
// OAuth state 저장용
// ========================================

const oauthStates =
  new Map();


async function saveOAuthState(
  state,
  guildId
) {

  oauthStates.set(
    state,
    {

      guildId,

      createdAt:
        Date.now()

    }
  );

}


// ========================================
// OAuth 인증 시작
// ========================================
//
// 관리자 페이지 외에도
// 필요하면 직접 /auth/discord?guildId=...
// 로 사용할 수 있다.
// ========================================

app.get(
  '/auth/discord',
  async (req, res) => {

    const guildId =
      String(
        req.query.guildId ||
        ''
      );


    if (!guildId) {

      return res.status(400)
        .send(
          'guildId가 필요합니다.'
        );

    }


    if (
      !client.guilds.cache.has(
        guildId
      )
    ) {

      return res.status(400)
        .send(
          '봇이 해당 서버에 들어가 있지 않습니다.'
        );

    }


    const oauth =
      createDiscordOAuthURL(
        guildId
      );


    await saveOAuthState(
      oauth.state,
      guildId
    );


    res.redirect(
      oauth.url
    );

  }
);


// ========================================
// OAuth Callback
// ========================================

app.get(
  '/auth/discord/callback',
  async (req, res) => {

    const {
      code,
      state,
      error
    } =
      req.query;


    if (error) {

      return res.send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<title>인증 취소</title>

<style>

body {

  margin: 0;

  min-height: 100vh;

  background: #0f1117;

  color: white;

  font-family: Arial;

  display: flex;

  align-items: center;

  justify-content: center;

}

.box {

  background: #181b23;

  padding: 35px;

  border-radius: 18px;

  text-align: center;

}

</style>

</head>

<body>

<div class="box">

<h1>
❌ 인증 취소
</h1>

<p>
Discord 인증이 취소되었습니다.
</p>

</div>

</body>

</html>

      `);

    }


    if (
      !code ||
      !state
    ) {

      return res.status(400)
        .send(
          'OAuth 인증 정보가 없습니다.'
        );

    }


    const stateData =
      oauthStates.get(
        state
      );


    if (!stateData) {

      return res.status(400)
        .send(
          'OAuth 인증 시간이 만료되었거나 잘못된 요청입니다.'
        );

    }


    oauthStates.delete(
      state
    );


    /*
     * OAuth state는 10분 이상 지난 경우 거부
     */

    if (
      Date.now() -
      stateData.createdAt >
      10 * 60 * 1000
    ) {

      return res.status(400)
        .send(
          '인증 요청이 만료되었습니다. 다시 인증해 주세요.'
        );

    }


    const guildId =
      stateData.guildId;


    try {

      // ==================================
      // code → access token
      // ==================================

      const tokenData =
        await exchangeCode(
          code
        );


      if (
        !tokenData.access_token
      ) {

        throw new Error(
          'Discord access token을 받지 못했습니다.'
        );

      }


      // ==================================
      // Discord 사용자 정보
      // ==================================

      const user =
        await getDiscordUser(
          tokenData.access_token
        );


      // ==================================
      // DB 저장
      // ==================================

      await saveAppUser(
        user,
        tokenData
      );


      // ==================================
      // 서버 확인
      // ==================================

      const guild =
        client.guilds.cache.get(
          guildId
        );


      if (!guild) {

        throw new Error(
          '봇이 해당 서버에 들어가 있지 않습니다.'
        );

      }


      // ==================================
      // 인증 역할 확인
      // ==================================

      const settings =
        guildSettings.get(
          guildId
        );


      const roleId =
        settings?.roleId ||
        null;


      // ==================================
      // 사용자 서버 참가
      // ==================================

      const result =
        await addUserToGuild(

          guildId,

          user.id,

          tokenData.access_token,

          roleId

        );


      /*
       * 201 = 새 멤버 추가
       * 204 = 이미 멤버인 경우 등 성공
       */

      if (!result.ok) {

        console.error(
          '서버 참가 실패:',
          result
        );


        return res.send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<title>인증 실패</title>

<style>

body {

  margin: 0;

  min-height: 100vh;

  background: #0f1117;

  color: white;

  font-family: Arial;

  display: flex;

  align-items: center;

  justify-content: center;

}

.box {

  background: #181b23;

  padding: 35px;

  border-radius: 18px;

  max-width: 500px;

  text-align: center;

}

</style>

</head>

<body>

<div class="box">

<h1>
❌ 서버 참가 실패
</h1>

<p>
Discord에서 서버 참가 권한을 승인했는지 확인해 주세요.
</p>

<p style="color:#888;">
오류 코드:
${escapeHtml(
  String(result.status)
)}
</p>

</div>

</body>

</html>

        `);

      }


      // ==================================
      // 역할 추가
      // ==================================

      if (roleId) {

        try {

          const member =
            await guild.members.fetch(
              user.id
            );


          const role =
            guild.roles.cache.get(
              roleId
            );


          if (
            role &&
            member
          ) {

            await member.roles.add(
              role
            );

          }

        } catch (roleError) {

          console.error(
            '인증 역할 지급 오류:',
            roleError
          );

        }

      }


      // ==================================
      // 성공
      // ==================================

      res.send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>
인증 완료
</title>

<style>

body {

  margin: 0;

  min-height: 100vh;

  background: #0f1117;

  color: white;

  font-family: Arial;

  display: flex;

  align-items: center;

  justify-content: center;

}

.box {

  width: min(
    500px,
    90vw
  );

  background: #181b23;

  padding: 40px;

  border-radius: 20px;

  text-align: center;

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.5);

}

.check {

  font-size: 60px;

}

h1 {

  margin-top: 10px;

}

.name {

  color: #8ea1ff;

}

</style>

</head>

<body>

<div class="box">

<div class="check">
✅
</div>

<h1>
인증이 완료되었습니다!
</h1>

<p>

<span class="name">
${escapeHtml(
  user.global_name ||
  user.username
)}
</span>
님이

<br>

서버에 참가되었습니다.

</p>

<p>
이 창을 닫아도 됩니다.
</p>

</div>

</body>

</html>

      `);

    } catch (error) {

      console.error(
        'OAuth callback 오류:',
        error
      );


      res.status(500)
        .send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<title>
인증 오류
</title>

</head>

<body>

<h1>
❌ 인증 처리 중 오류가 발생했습니다.
</h1>

<p>
잠시 후 다시 시도해 주세요.
</p>

</body>

</html>

        `);

    }

  }
);


// ========================================
// 앱 설치 사용자 목록
// ========================================

app.get(
  '/api/app-users',
  requireLogin,
  async (req, res) => {

    try {

      const users =
        await getAppUsers();


      res.json({

        ok: true,

        users

      });

    } catch (error) {

      console.error(
        error
      );


      res.status(500)
        .json({

          ok: false,

          error:
            '사용자 목록을 가져오지 못했습니다.'

        });

    }

  }
);


// ========================================
// 선택한 사용자 서버 참가
// ========================================

app.post(
  '/api/invite-app-users',
  requireLogin,
  async (req, res) => {

    const {
      guildId,
      userIds
    } =
      req.body;


    if (
      typeof guildId !==
      'string'
    ) {

      return res.status(400)
        .json({

          ok: false,

          error:
            'guildId가 필요합니다.'

        });

    }


    if (
      !Array.isArray(userIds) ||
      userIds.length === 0
    ) {

      return res.status(400)
        .json({

          ok: false,

          error:
            '사용자를 한 명 이상 선택해 주세요.'

        });

    }


    if (
      userIds.length > 100
    ) {

      return res.status(400)
        .json({

          ok: false,

          error:
            '한 번에 최대 100명까지 처리할 수 있습니다.'

        });

    }


    // ==================================
    // 봇 서버 확인
    // ==================================

    const guild =
      client.guilds.cache.get(
        guildId
      );


    if (!guild) {

      return res.status(404)
        .json({

          ok: false,

          error:
            '봇이 해당 서버에 들어가 있지 않습니다.'

        });

    }


    // ==================================
    // 서버 인증 역할
    // ==================================

    const settings =
      guildSettings.get(
        guildId
      );


    const roleId =
      settings?.roleId ||
      null;


    const results =
      [];


    // ==================================
    // 사용자별 처리
    // ==================================

    for (
      const userId
      of userIds
    ) {

      try {

        const token =
          await getUserToken(
            userId
          );


        if (!token) {

          results.push({

            userId,

            ok: false,

            error:
              'OAuth 권한이 없거나 토큰이 만료되었습니다.'

          });

          continue;

        }


        const result =
          await addUserToGuild(

            guildId,

            userId,

            token,

            roleId

          );


        if (!result.ok) {

          results.push({

            userId,

            ok: false,

            status:
              result.status,

            error:
              result.data?.message ||
              '서버 참가에 실패했습니다.'

          });

          continue;

        }


        // ==================================
        // 역할 지급
        // ==================================

        if (roleId) {

          try {

            const member =
              await guild.members.fetch(
                userId
              );


            const role =
              guild.roles.cache.get(
                roleId
              );


            if (
              role &&
              member
            ) {

              await member.roles.add(
                role
              );

            }

          } catch (roleError) {

            console.error(
              `역할 지급 실패 (${userId}):`,
              roleError
            );

          }

        }


        results.push({

          userId,

          ok: true

        });


      } catch (error) {

        console.error(
          `사용자 참가 처리 오류 (${userId}):`,
          error
        );


        results.push({

          userId,

          ok: false,

          error:
            '처리 중 오류가 발생했습니다.'

        });

      }

    }


    res.json({

      ok: true,

      results

    });

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
    } =
      req.body;


    if (
      typeof content !==
      'string' ||
      !content.trim()
    ) {

      return res.json({

        ok: false,

        error:
          '메시지를 입력해 주세요.'

      });

    }


    if (
      content.length >
      2000
    ) {

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
// HTML 보안 처리
// ========================================

function escapeHtml(
  text
) {

  return String(text)

    .replace(
      /&/g,
      '&amp;'
    )

    .replace(
      /</g,
      '&lt;'
    )

    .replace(
      />/g,
      '&gt;'
    )

    .replace(
      /"/g,
      '&quot;'
    )

    .replace(
      /'/g,
      '&#039;'
    );

}


// ========================================
// OAuth State 자동 정리
// ========================================

setInterval(
  () => {

    const now =
      Date.now();


    for (
      const [
        state,
        data
      ]
      of oauthStates
    ) {

      if (
        now -
        data.createdAt >
        10 * 60 * 1000
      ) {

        oauthStates.delete(
          state
        );

      }

    }

  },
  60 * 1000
);


// ========================================
// 웹 서버 시작
// ========================================

async function start() {

  try {

    await initDatabase();


    server.listen(
      PORT,
      () => {

        console.log(
          `🌐 웹 관리자 페이지 실행: ${PORT}`
        );

      }
    );


    console.log(
      '🔄 Discord 로그인 시도 중...'
    );


    client.login(TOKEN)

      .then(
        () => {

          console.log(
            '🔑 Discord 로그인 요청 완료'
          );

        }
      )

      .catch(
        error => {

          console.error(
            '❌ Discord 로그인 실패:',
            error
          );

        }
      );


  } catch (error) {

    console.error(
      '❌ 서버 시작 실패:',
      error
    );

    process.exit(1);

  }

}


start();
