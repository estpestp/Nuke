const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = '1554802340782018610';

// 서버별 인증 역할
const verifiedRoles = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// =========================
// 슬래시 명령어
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName('인증설정')
    .setDescription('이 서버의 인증 완료 역할을 설정합니다.')
    .addRoleOption(option =>
      option
        .setName('역할')
        .setDescription('인증 완료 시 지급할 역할을 선택합니다.')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('인증')
    .setDescription('서버 인증 패널을 생성합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

// =========================
// 슬래시 명령어 등록
// =========================

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('슬래시 명령어를 등록하고 있습니다...');

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log('슬래시 명령어 등록이 완료되었습니다.');
  } catch (error) {
    console.error('슬래시 명령어 등록 오류:', error);
  }
}

// =========================
// 봇 로그인
// =========================

client.once('ready', () => {
  console.log(`온라인: ${client.user.tag}`);
});

// =========================
// 인터랙션 처리
// =========================

client.on('interactionCreate', async interaction => {

  // =========================
  // /인증설정
  // =========================

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === '인증설정') {

      const role = interaction.options.getRole('역할');
      const botMember = interaction.guild.members.me;

      if (!botMember) {
        return interaction.reply({
          content: '❌ 봇 정보를 가져올 수 없습니다.',
          ephemeral: true
        });
      }

      // 봇보다 높은 역할인지 확인
      if (role.position >= botMember.roles.highest.position) {
        return interaction.reply({
          content:
            '❌ 해당 역할은 지급할 수 없습니다.\n' +
            '봇의 역할을 인증 역할보다 위로 이동해 주세요.',
          ephemeral: true
        });
      }

      // 서버 ID → 역할 ID 저장
      verifiedRoles.set(
        interaction.guild.id,
        role.id
      );

      return interaction.reply({
        content:
          `✅ 인증 역할이 ${role}로 설정되었습니다.\n\n` +
          '이제 `/인증` 명령어를 사용하여 인증 패널을 생성할 수 있습니다.',
        ephemeral: true
      });
    }

    // =========================
    // /인증
    // =========================

    if (interaction.commandName === '인증') {

      const roleId = verifiedRoles.get(
        interaction.guild.id
      );

      if (!roleId) {
        return interaction.reply({
          content:
            '❌ 아직 인증 역할이 설정되지 않았습니다.\n' +
            '`/인증설정` 명령어를 먼저 사용해 주세요.',
          ephemeral: true
        });
      }

      const role = interaction.guild.roles.cache.get(roleId);

      if (!role) {
        verifiedRoles.delete(interaction.guild.id);

        return interaction.reply({
          content:
            '❌ 설정된 인증 역할을 찾을 수 없습니다.\n' +
            '`/인증설정` 명령어를 다시 사용해 주세요.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔐 서버 인증')
        .setDescription(
          '서버 이용을 시작하시려면 아래 **인증하기** 버튼을 눌러주세요.\n\n' +
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

      return interaction.reply({
        embeds: [embed],
        components: [row]
      });
    }
  }

  // =========================
  // 인증 버튼
  // =========================

  if (interaction.isButton()) {

    if (interaction.customId !== 'verify') {
      return;
    }

    const roleId = verifiedRoles.get(
      interaction.guild.id
    );

    if (!roleId) {
      return interaction.reply({
        content:
          '❌ 이 서버의 인증 역할이 설정되지 않았습니다.',
        ephemeral: true
      });
    }

    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
      return interaction.reply({
        content:
          '❌ 인증 역할을 찾을 수 없습니다. 서버 관리자에게 문의해 주세요.',
        ephemeral: true
      });
    }

    const member = interaction.member;

    // 이미 인증된 경우
    if (member.roles.cache.has(role.id)) {
      return interaction.reply({
        content: '✅ 이미 인증이 완료되었습니다.',
        ephemeral: true
      });
    }

    try {

      await member.roles.add(role);

      return interaction.reply({
        content:
          `✅ 인증이 완료되었습니다!\n${role} 역할이 지급되었습니다.`,
        ephemeral: true
      });

    } catch (error) {

      console.error('역할 지급 오류:', error);

      return interaction.reply({
        content:
          '❌ 역할 지급에 실패했습니다.\n' +
          '봇의 역할 위치와 역할 관리 권한을 확인해 주세요.',
        ephemeral: true
      });
    }
  }
});

// =========================
// 실행
// =========================

async function start() {
  await registerCommands();
  await client.login(TOKEN);
}

start();
