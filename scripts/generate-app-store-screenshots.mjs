import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs/app-store/screenshots/zh-HK/6.5-inch');
const WIDTH = 1242;
const HEIGHT = 2688;
const UI_X = 112;
const UI_Y = 650;
const UI_WIDTH = 1018;
const UI_HEIGHT = 2110;

const colors = {
  background: '#FBF7F2',
  surface: '#FFFFFF',
  surfaceSecondary: '#F3ECE5',
  textPrimary: '#302B27',
  textSecondary: '#675F59',
  textTertiary: '#8C827A',
  primary: '#C9604F',
  primarySoft: '#F7E3DD',
  secondary: '#6F8C78',
  secondarySoft: '#E4ECE5',
  border: '#E5DDD5',
  success: '#3F7D59',
  warning: '#A96D22',
  tabInactive: '#91877F',
};

const screenshots = [
  {
    filename: '01-home.png',
    headline: '一家人，一起照顧',
    subtitle: '毛孩近況、今日照顧與生活回憶，一眼掌握。',
    source: 'src/features/home/home-screen.tsx',
    accent: colors.primary,
    screen: homeScreen,
    activeTab: 'home',
  },
  {
    filename: '02-journal.png',
    headline: '用相片記住每一天',
    subtitle: '把文字與相片放進日記，保存毛孩的每個生活片段。',
    source: 'src/features/journal/journal-screen.tsx',
    accent: colors.secondary,
    screen: journalScreen,
    activeTab: 'journal',
  },
  {
    filename: '03-memory.png',
    headline: '回憶沿時間慢慢累積',
    subtitle: '沿著時間線，重新看見一起走過的日子。',
    source: 'src/features/journal/journal-screen.tsx',
    accent: '#B77A55',
    screen: memoryScreen,
    activeTab: 'journal',
  },
  {
    filename: '04-family.png',
    headline: '只與信任的家人共享',
    subtitle: '邀請家人一起加入，日記與照顧記錄都留在私人家庭空間。',
    source: 'src/features/family/pet-members-screen.tsx',
    accent: colors.secondary,
    screen: familyScreen,
    activeTab: null,
  },
  {
    filename: '05-care.png',
    headline: '每天的照顧，清楚可見',
    subtitle: '餵食、散步、梳洗與用藥，完成過的照顧都有記錄。',
    source: 'src/features/care/care-history-screen.tsx',
    accent: colors.primary,
    screen: careScreen,
    activeTab: null,
  },
  {
    filename: '06-reminders.png',
    headline: '重要照顧，不易遺漏',
    subtitle: '設定一次或重複提醒，把重要的照顧事項安排好。',
    source: 'src/features/reminders/reminders-screen.tsx',
    accent: '#A96D22',
    screen: remindersScreen,
    activeTab: null,
  },
  {
    filename: '07-pet-profile.png',
    headline: '每隻毛孩，都有自己的空間',
    subtitle: '從基本資料到生活回憶，慢慢累積屬於牠的故事。',
    source: 'src/features/pets/pet-detail-screen.tsx',
    accent: colors.secondary,
    screen: profileScreen,
    activeTab: null,
  },
];

const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'PingFang HK', 'PingFang TC', 'Noto Sans CJK TC', sans-serif";

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function text(
  x,
  y,
  value,
  size = 34,
  weight = 400,
  fill = colors.textPrimary,
  options = {},
) {
  const { anchor = 'start', letterSpacing = 0, opacity = 1 } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}" opacity="${opacity}">${escapeXml(value)}</text>`;
}

function multiline(x, y, lines, size, lineHeight, weight, fill, options = {}) {
  return lines
    .map((line, index) =>
      text(x, y + index * lineHeight, line, size, weight, fill, options),
    )
    .join('');
}

function roundedRect(x, y, width, height, radius, fill, options = {}) {
  const {
    stroke = 'none',
    strokeWidth = 0,
    opacity = 1,
    filter = '',
  } = options;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"${filter ? ` filter="url(#${filter})"` : ''}/>`;
}

function circle(cx, cy, radius, fill, opacity = 1) {
  return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" opacity="${opacity}"/>`;
}

function line(x1, y1, x2, y2, stroke = colors.border, strokeWidth = 2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
}

function pill(x, y, label, options = {}) {
  const {
    width = 130,
    fill = colors.primarySoft,
    color = colors.primary,
    icon = '',
  } = options;
  return [
    roundedRect(x, y, width, 52, 26, fill),
    icon
      ? text(x + 24, y + 35, icon, 24, 700, color, { anchor: 'middle' })
      : '',
    text(x + (icon ? 47 : width / 2), y + 35, label, 25, 600, color, {
      anchor: icon ? 'start' : 'middle',
    }),
  ].join('');
}

function iconBadge(x, y, symbol, options = {}) {
  const {
    fill = colors.primarySoft,
    color = colors.primary,
    size = 58,
  } = options;
  return [
    roundedRect(x, y, size, size, size / 2, fill),
    text(x + size / 2, y + size * 0.69, symbol, size * 0.42, 700, color, {
      anchor: 'middle',
    }),
  ].join('');
}

function imageTag(dataUri, x, y, width, height, radius = 24, id = '') {
  const clipId = `img-${id || `${x}-${y}-${width}-${height}`}`.replaceAll(
    '.',
    '-',
  );
  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs><image href="${dataUri}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
}

function petSelector(y, assets, subtitle = '柴犬 · 3歲') {
  return [
    roundedRect(54, y, 910, 138, 28, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    imageTag(assets.portrait, 78, y + 19, 100, 100, 50, `pet-${y}`),
    text(204, y + 58, 'Mochi', 38, 700),
    text(204, y + 99, subtitle, 27, 400, colors.textSecondary),
    text(925, y + 82, '⌄', 34, 600, colors.textSecondary, { anchor: 'middle' }),
  ].join('');
}

function statusBar() {
  return [
    text(62, 57, '9:41', 28, 700),
    `<g transform="translate(836 34)" stroke="${colors.textPrimary}" stroke-width="5" fill="none" stroke-linecap="round"><path d="M0 18h4M13 13h4v5M26 8h4v10M39 3h4v15"/><path d="M63 16c12-14 28-14 40 0M72 18c7-8 15-8 22 0"/><rect x="120" y="1" width="51" height="23" rx="6"/><rect x="174" y="8" width="5" height="9" rx="2" fill="${colors.textPrimary}" stroke="none"/><rect x="124" y="5" width="40" height="15" rx="3" fill="${colors.textPrimary}" stroke="none"/></g>`,
  ].join('');
}

function backHeader(titleValue, subtitleValue = '') {
  return [
    iconBadge(48, 96, '‹', {
      fill: colors.surfaceSecondary,
      color: colors.textPrimary,
      size: 58,
    }),
    text(126, 139, titleValue, 52, 700),
    subtitleValue
      ? text(126, 178, subtitleValue, 26, 400, colors.textSecondary)
      : '',
  ].join('');
}

function tabBar(activeTab) {
  const tabs = [
    { key: 'home', label: '首頁', symbol: '⌂', x: 145 },
    { key: 'journal', label: '日記', symbol: '▤', x: 360 },
    { key: 'profile', label: '我的', symbol: '○', x: 870 },
  ];
  const y = UI_HEIGHT - 150;
  return [
    roundedRect(0, y, UI_WIDTH, 180, 0, colors.surface),
    line(0, y, UI_WIDTH, y, colors.border, 2),
    ...tabs.map((tab) => {
      const active = tab.key === activeTab;
      const color = active ? colors.primary : colors.tabInactive;
      return [
        text(tab.x, y + 62, tab.symbol, 38, 700, color, { anchor: 'middle' }),
        text(tab.x, y + 105, tab.label, 23, 600, color, { anchor: 'middle' }),
      ].join('');
    }),
    circle(615, y + 45, 54, colors.primary),
    text(615, y + 61, '+', 50, 500, '#FFFFFF', { anchor: 'middle' }),
  ].join('');
}

function appScaffold(content, activeTab) {
  return [
    roundedRect(0, 0, UI_WIDTH, UI_HEIGHT, 52, colors.background),
    statusBar(),
    content,
    activeTab ? tabBar(activeTab) : '',
  ].join('');
}

function sectionTitle(y, titleValue, action = '') {
  return [
    text(54, y, titleValue, 35, 700),
    action
      ? text(962, y, action, 25, 600, colors.primary, { anchor: 'end' })
      : '',
  ].join('');
}

function careRow(y, symbol, titleValue, detail, time, color = colors.primary) {
  return [
    iconBadge(80, y, symbol, {
      fill:
        color === colors.primary ? colors.primarySoft : colors.secondarySoft,
      color,
      size: 64,
    }),
    text(170, y + 30, titleValue, 30, 600),
    text(170, y + 63, detail, 24, 400, colors.textSecondary),
    text(912, y + 45, time, 23, 500, colors.textTertiary, { anchor: 'end' }),
  ].join('');
}

function homeScreen(assets) {
  const content = [
    text(54, 133, '早晨好', 54, 700),
    text(54, 178, '今天也留一點時間給彼此。', 27, 400, colors.textSecondary),
    iconBadge(900, 105, '•', {
      size: 60,
      fill: colors.surface,
      color: colors.primary,
    }),
    petSelector(224, assets),
    roundedRect(54, 386, 910, 78, 25, colors.secondarySoft),
    iconBadge(76, 397, '♡', {
      fill: colors.secondarySoft,
      color: colors.secondary,
      size: 56,
    }),
    text(150, 437, '陪伴你的第 1,268 天', 29, 650),
    sectionTitle(530, '今日照顧', '查看全部'),
    roundedRect(54, 558, 910, 280, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    careRow(585, '✓', '早餐完成', '主人 · 08:10', '已完成'),
    line(80, 670, 938, 670),
    careRow(
      691,
      '⌁',
      '散步 25 分鐘',
      '家人 · 10:25',
      '已完成',
      colors.secondary,
    ),
    line(80, 776, 938, 776),
    sectionTitle(912, '最近回憶', '查看日記'),
    roundedRect(54, 940, 910, 455, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    imageTag(assets.harbour, 76, 962, 866, 258, 24, 'home-memory'),
    pill(78, 1242, '最近回憶', {
      width: 160,
      fill: colors.primarySoft,
      color: colors.primary,
    }),
    text(78, 1334, '今天去公園散步', 35, 700),
    text(
      78,
      1373,
      '陽光很好，Mochi 玩得很開心。',
      25,
      400,
      colors.textSecondary,
    ),
    sectionTitle(1476, '家庭近況', '家庭成員'),
    roundedRect(54, 1504, 910, 314, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    iconBadge(82, 1537, '主', {
      size: 64,
      fill: colors.primarySoft,
      color: colors.primary,
    }),
    text(170, 1570, '主人新增了生活日記', 29, 600),
    text(170, 1605, '今天 · 10:42', 23, 400, colors.textSecondary),
    line(82, 1644, 936, 1644),
    iconBadge(82, 1671, '家', {
      size: 64,
      fill: colors.secondarySoft,
      color: colors.secondary,
    }),
    text(170, 1704, '家人完成了散步', 29, 600),
    text(170, 1739, '25 分鐘 · 今天 10:25', 23, 400, colors.textSecondary),
  ].join('');
  return appScaffold(content, 'home');
}

function journalScreen(assets) {
  const content = [
    text(54, 133, '日記', 54, 700),
    text(
      54,
      178,
      'Mochi 的生活，由家人一起慢慢寫下。',
      27,
      400,
      colors.textSecondary,
    ),
    roundedRect(852, 104, 112, 64, 30, colors.primary),
    text(908, 146, '新增', 27, 650, '#FFFFFF', { anchor: 'middle' }),
    pill(54, 218, 'Mochi', {
      width: 182,
      fill: colors.secondarySoft,
      color: colors.secondary,
      icon: '●',
    }),
    text(54, 334, '2026', 46, 700),
    text(54, 386, '8月', 30, 700, colors.primary),
    circle(72, 440, 8, colors.primary),
    line(72, 448, 72, 1770, colors.border, 4),
    text(104, 450, '8月28日 · 今天', 27, 500, colors.textSecondary),
    roundedRect(104, 480, 842, 1060, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    text(138, 535, '今天去公園散步', 38, 700),
    text(138, 578, '主人 · 上午 10:42', 24, 400, colors.textSecondary),
    imageTag(assets.harbour, 138, 620, 774, 410, 24, 'journal-hero'),
    imageTag(assets.portrait, 138, 1050, 374, 310, 24, 'journal-small-a'),
    imageTag(assets.meal, 538, 1050, 374, 310, 24, 'journal-small-b'),
    multiline(
      138,
      1416,
      ['陽光很好，Mochi 玩得很開心。', '沿著草地走了很久，回家後睡得特別香。'],
      27,
      40,
      400,
      colors.textPrimary,
    ),
    pill(138, 1480, '散步', {
      width: 112,
      fill: colors.secondarySoft,
      color: colors.secondary,
    }),
    circle(72, 1624, 8, colors.primary),
    text(104, 1634, '8月24日', 27, 500, colors.textSecondary),
    roundedRect(104, 1664, 842, 240, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    imageTag(assets.meal, 132, 1692, 210, 184, 22, 'journal-meal'),
    text(372, 1745, '早餐時間', 33, 700),
    text(372, 1790, '新鮮早餐大成功。', 25, 400, colors.textSecondary),
    pill(372, 1820, '日常', {
      width: 108,
      fill: colors.primarySoft,
      color: colors.primary,
    }),
  ].join('');
  return appScaffold(content, 'journal');
}

function memoryEntry(y, date, titleValue, body, imageUri, id) {
  return [
    circle(78, y + 22, 10, colors.primary),
    text(112, y + 30, date, 27, 600, colors.textSecondary),
    roundedRect(112, y + 58, 834, 360, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    imageTag(imageUri, 136, y + 82, 270, 312, 23, id),
    text(438, y + 136, titleValue, 33, 700),
    multiline(438, y + 184, body, 25, 36, 400, colors.textSecondary),
    pill(438, y + 303, '生活回憶', {
      width: 156,
      fill: colors.primarySoft,
      color: colors.primary,
    }),
  ].join('');
}

function memoryScreen(assets) {
  const content = [
    text(54, 133, '生命時間軸', 54, 700),
    text(
      54,
      178,
      'Mochi 的回憶，沿著日期慢慢累積。',
      27,
      400,
      colors.textSecondary,
    ),
    pill(54, 218, 'Mochi', {
      width: 182,
      fill: colors.secondarySoft,
      color: colors.secondary,
      icon: '●',
    }),
    text(54, 334, '2026', 46, 700),
    line(78, 400, 78, 1920, colors.border, 5),
    memoryEntry(
      400,
      '8月28日 · 今天',
      '公園散步的早晨',
      ['陽光很好，Mochi', '玩得很開心。'],
      assets.harbour,
      'memory-a',
    ),
    memoryEntry(
      860,
      '8月24日',
      '最期待的早餐',
      ['吃完還坐在碗旁，', '等著家人摸摸牠。'],
      assets.meal,
      'memory-b',
    ),
    text(54, 1374, '2025', 46, 700),
    memoryEntry(
      1430,
      '8月28日 · 一年前',
      '第一次走到海旁',
      ['微風吹著毛毛，', '一起看了很久的海。'],
      assets.portrait,
      'memory-c',
    ),
  ].join('');
  return appScaffold(content, 'journal');
}

function memberRow(y, initial, name, role, tint, roleColor) {
  return [
    iconBadge(84, y, initial, { size: 74, fill: tint, color: roleColor }),
    text(184, y + 35, name, 32, 650),
    text(184, y + 70, role, 24, 400, colors.textSecondary),
    pill(772, y + 12, role.includes('管理') ? '管理者' : '家庭成員', {
      width: role.includes('管理') ? 142 : 164,
      fill: tint,
      color: roleColor,
    }),
  ].join('');
}

function familyScreen(assets) {
  const content = [
    backHeader('家庭成員', '共有 3 人一起照顧 Mochi。'),
    petSelector(226, assets, '私人家庭空間'),
    sectionTitle(438, '家庭成員'),
    roundedRect(54, 470, 910, 408, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    memberRow(
      505,
      '主',
      '主人',
      '毛孩管理者',
      colors.primarySoft,
      colors.primary,
    ),
    line(84, 604, 934, 604),
    memberRow(
      641,
      '家',
      '家人',
      '家庭成員',
      colors.secondarySoft,
      colors.secondary,
    ),
    line(84, 740, 934, 740),
    memberRow(777, '姨', '阿姨', '家庭成員', '#F5ECD9', colors.warning),
    roundedRect(54, 934, 910, 300, 30, colors.secondarySoft),
    iconBadge(82, 968, '鎖', {
      size: 66,
      fill: colors.surface,
      color: colors.secondary,
    }),
    text(176, 1012, '只屬於家人的私人空間', 34, 700),
    multiline(
      82,
      1076,
      ['Mochi 的日記、相片與照顧記錄，', '只會與你邀請的家庭成員共享。'],
      27,
      42,
      400,
      colors.textSecondary,
    ),
    sectionTitle(1314, '一起照顧 Mochi'),
    roundedRect(54, 1346, 910, 368, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    iconBadge(82, 1380, '✓', {
      size: 62,
      fill: colors.primarySoft,
      color: colors.primary,
    }),
    text(170, 1418, '日記與回憶', 30, 650),
    text(170, 1453, '家人一起保存生活片段', 24, 400, colors.textSecondary),
    line(82, 1490, 934, 1490),
    iconBadge(82, 1524, '♡', {
      size: 62,
      fill: colors.secondarySoft,
      color: colors.secondary,
    }),
    text(170, 1562, '照顧記錄', 30, 650),
    text(170, 1597, '每一次完成都清楚可見', 24, 400, colors.textSecondary),
    line(82, 1634, 934, 1634),
    iconBadge(82, 1668, '鈴', {
      size: 62,
      fill: '#F5ECD9',
      color: colors.warning,
    }),
    text(170, 1706, '家庭提醒', 30, 650),
    text(170, 1741, '一起安排重要照顧事項', 24, 400, colors.textSecondary),
  ].join('');
  return appScaffold(content, null);
}

function fullCareRow(y, symbol, titleValue, meta, note, tint, color) {
  return [
    roundedRect(54, y, 910, 204, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    iconBadge(82, y + 30, symbol, { size: 70, fill: tint, color }),
    text(178, y + 68, titleValue, 32, 650),
    text(178, y + 106, meta, 24, 400, colors.textSecondary),
    note ? text(178, y + 156, note, 25, 400, colors.textPrimary) : '',
    pill(790, y + 28, '已完成', {
      width: 138,
      fill: colors.secondarySoft,
      color: colors.success,
    }),
  ].join('');
}

function careScreen(assets) {
  const content = [
    backHeader('照顧歷史', '毛孩家庭共同分享的已完成照顧。'),
    petSelector(224, assets),
    text(54, 426, '今天', 36, 700),
    fullCareRow(
      458,
      '✓',
      '早餐完成',
      '主人 · 上午 8:10',
      '吃得很開心，精神很好。',
      colors.primarySoft,
      colors.primary,
    ),
    fullCareRow(
      686,
      '⌁',
      '散步 25 分鐘',
      '家人 · 上午 10:25',
      '沿著公園草地慢慢走。',
      colors.secondarySoft,
      colors.secondary,
    ),
    fullCareRow(
      914,
      '✦',
      '梳洗完成',
      '主人 · 下午 2:30',
      '毛毛梳得很柔順。',
      '#F5ECD9',
      colors.warning,
    ),
    fullCareRow(
      1142,
      '+',
      '用藥記錄',
      '主人 · 下午 6:00',
      '已按家庭照顧安排完成。',
      '#EFE8F6',
      '#775A8C',
    ),
    text(54, 1426, '昨天', 36, 700),
    fullCareRow(
      1458,
      '☂',
      '洗澡完成',
      '家人 · 下午 4:20',
      '洗完澡後在窗邊休息。',
      colors.secondarySoft,
      colors.secondary,
    ),
  ].join('');
  return appScaffold(content, null);
}

function taskCard(
  y,
  symbol,
  titleValue,
  schedule,
  timeValue,
  done,
  tint,
  color,
) {
  return [
    roundedRect(54, y, 910, 190, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    iconBadge(82, y + 30, symbol, { size: 68, fill: tint, color }),
    text(176, y + 65, titleValue, 32, 650),
    text(
      176,
      y + 107,
      `${schedule} · ${timeValue}`,
      25,
      400,
      colors.textSecondary,
    ),
    pill(774, y + 32, done ? '已完成' : '待完成', {
      width: 154,
      fill: done ? colors.secondarySoft : colors.primarySoft,
      color: done ? colors.success : colors.primary,
    }),
    done
      ? text(176, y + 153, '由主人完成', 23, 500, colors.success)
      : text(176, y + 153, '家庭共享提醒', 23, 500, colors.textTertiary),
  ].join('');
}

function remindersScreen(assets) {
  const content = [
    backHeader('提醒', '共享家庭照顧任務與本機提醒。'),
    iconBadge(900, 104, '+', {
      size: 58,
      fill: colors.primary,
      color: '#FFFFFF',
    }),
    petSelector(224, assets, '目前選擇的毛孩家庭'),
    text(54, 426, '今天', 36, 700),
    taskCard(
      458,
      '✓',
      '早餐',
      '每天',
      '上午 8:00',
      true,
      colors.primarySoft,
      colors.primary,
    ),
    taskCard(
      672,
      '○',
      '晚餐',
      '每天',
      '下午 6:30',
      false,
      colors.primarySoft,
      colors.primary,
    ),
    taskCard(
      886,
      '✦',
      '每週梳毛',
      '每週六',
      '上午 11:00',
      false,
      colors.secondarySoft,
      colors.secondary,
    ),
    text(54, 1168, '未來 30 天', 36, 700),
    taskCard(
      1200,
      '☂',
      '下次洗澡',
      '單次 · 9月6日',
      '下午 3:00',
      false,
      '#F5ECD9',
      colors.warning,
    ),
    taskCard(
      1414,
      '⌁',
      '週末散步',
      '每週日',
      '上午 9:30',
      false,
      colors.secondarySoft,
      colors.secondary,
    ),
    roundedRect(54, 1660, 910, 128, 28, colors.secondarySoft),
    iconBadge(80, 1692, '鈴', {
      size: 62,
      fill: colors.surface,
      color: colors.secondary,
    }),
    text(166, 1718, '提醒已安排好', 29, 650),
    text(
      166,
      1754,
      '重要照顧會按時出現在家庭清單。',
      23,
      400,
      colors.textSecondary,
    ),
  ].join('');
  return appScaffold(content, null);
}

function detailRow(y, label, value) {
  return [
    text(82, y, label, 25, 400, colors.textSecondary),
    text(914, y, value, 28, 550, colors.textPrimary, { anchor: 'end' }),
    line(82, y + 30, 936, y + 30),
  ].join('');
}

function profileScreen(assets) {
  const content = [
    iconBadge(48, 96, '‹', {
      fill: colors.surfaceSecondary,
      color: colors.textPrimary,
      size: 58,
    }),
    imageTag(assets.portrait, 349, 132, 320, 320, 160, 'profile-portrait'),
    text(509, 520, 'Mochi', 58, 700, colors.textPrimary, { anchor: 'middle' }),
    text(509, 566, '柴犬 · 男生', 30, 550, colors.textSecondary, {
      anchor: 'middle',
    }),
    roundedRect(54, 614, 436, 158, 30, colors.secondarySoft),
    text(272, 674, '3歲', 42, 700, colors.secondary, { anchor: 'middle' }),
    text(272, 722, '年齡', 24, 400, colors.textSecondary, { anchor: 'middle' }),
    roundedRect(528, 614, 436, 158, 30, colors.primarySoft),
    text(746, 674, '1,268', 42, 700, colors.primary, { anchor: 'middle' }),
    text(746, 722, '陪伴天數', 24, 400, colors.textSecondary, {
      anchor: 'middle',
    }),
    roundedRect(54, 820, 910, 612, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    text(82, 878, '基本資料', 34, 700),
    detailRow(950, '種類', '狗狗'),
    detailRow(1034, '品種', '柴犬'),
    detailRow(1118, '生日', '2023年5月18日'),
    detailRow(1202, '到家日', '2023年3月10日'),
    detailRow(1286, '體重', '9.2 公斤'),
    roundedRect(54, 1478, 910, 276, 30, colors.surface, {
      stroke: colors.border,
      strokeWidth: 2,
    }),
    text(82, 1536, '關於 Mochi', 34, 700),
    multiline(
      82,
      1596,
      ['喜歡散步、曬太陽和家人的陪伴。', '聽到零食袋的聲音就會立刻跑過來。'],
      27,
      43,
      400,
      colors.textSecondary,
    ),
    roundedRect(82, 1694, 854, 2, 0, colors.border),
    text(82, 1731, '家庭成員 3', 25, 600, colors.primary),
  ].join('');
  return appScaffold(content, null);
}

function marketingSvg(item, appContent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="phoneShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#6A493B" flood-opacity="0.18"/>
    </filter>
    <clipPath id="uiClip"><rect x="0" y="0" width="${UI_WIDTH}" height="${UI_HEIGHT}" rx="52"/></clipPath>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${colors.background}"/>
  ${circle(1098, 148, 152, colors.primarySoft, 0.72)}
  ${circle(114, 510, 76, colors.secondarySoft, 0.9)}
  ${roundedRect(80, 66, 255, 54, 27, colors.surface)}
  ${circle(110, 93, 12, item.accent)}
  ${text(136, 102, 'HOMEYPAW', 25, 750, colors.textSecondary, { letterSpacing: 2.2 })}
  ${text(80, 254, item.headline, 78, 750, colors.textPrimary, { letterSpacing: -1.2 })}
  ${text(80, 342, item.subtitle, 36, 430, colors.textSecondary)}
  ${roundedRect(78, 616, 1086, 2170, 70, '#3E3935', { filter: 'phoneShadow' })}
  ${roundedRect(94, 632, 1054, 2138, 58, colors.surface)}
  <g clip-path="url(#uiClip)" transform="translate(${UI_X} ${UI_Y})">${appContent}</g>
</svg>`;
}

async function dataUri(filePath) {
  const extension = path.extname(filePath).slice(1);
  const mime = extension === 'svg' ? 'image/svg+xml' : `image/${extension}`;
  const data = await fs.readFile(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function renderContactSheet(files) {
  const thumbWidth = 270;
  const thumbHeight = Math.round((thumbWidth * HEIGHT) / WIDTH);
  const gap = 38;
  const margin = 58;
  const titleHeight = 150;
  const columns = 4;
  const rows = 2;
  const sheetWidth = margin * 2 + columns * thumbWidth + (columns - 1) * gap;
  const sheetHeight = titleHeight + rows * thumbHeight + (rows - 1) * 72 + 92;
  const background = Buffer.from(`
    <svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${colors.background}"/>
      ${text(margin, 68, 'HomeyPaw · App Store Screenshots', 38, 700)}
      ${text(margin, 112, '繁體中文（香港） · iPhone 6.5-inch · 1242 × 2688', 23, 400, colors.textSecondary)}
    </svg>`);
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (thumbWidth + gap);
    const top = titleHeight + row * (thumbHeight + 72);
    const thumbnail = await sharp(files[index].path)
      .resize(thumbWidth, thumbHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    composites.push({ input: thumbnail, left, top });
  }
  const output = path.join(
    OUTPUT,
    'homeypaw-app-store-screenshots-preview.png',
  );
  await sharp(background)
    .flatten({ background: colors.background })
    .composite(composites)
    .removeAlpha()
    .toColourspace('srgb')
    .png({ compressionLevel: 9, palette: false })
    .toFile(output);
  return output;
}

async function main() {
  await fs.mkdir(OUTPUT, { recursive: true });
  const assets = {
    portrait: await dataUri(path.join(ROOT, 'assets/images/pet-portrait.svg')),
    harbour: await dataUri(path.join(ROOT, 'assets/images/harbour-walk.svg')),
    meal: await dataUri(path.join(ROOT, 'assets/images/cozy-meal.svg')),
  };
  const generated = [];
  for (const item of screenshots) {
    const svg = marketingSvg(item, item.screen(assets));
    const outputPath = path.join(OUTPUT, item.filename);
    await sharp(Buffer.from(svg))
      .flatten({ background: colors.background })
      .toColourspace('srgb')
      .png({ compressionLevel: 9, palette: false })
      .toFile(outputPath);
    const metadata = await sharp(outputPath).metadata();
    const stats = await fs.stat(outputPath);
    generated.push({
      filename: item.filename,
      headline: item.headline,
      source: item.source,
      path: outputPath,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      space: metadata.space,
      size: stats.size,
    });
  }
  const contactSheet = await renderContactSheet(generated);
  process.stdout.write(
    `${JSON.stringify({ contactSheet, files: generated }, null, 2)}\n`,
  );
}

await main();
