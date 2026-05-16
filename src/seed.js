const bcrypt = require('bcryptjs');
const { categories, forumTopics } = require('./constants');

const imagePool = [
  'https://picsum.photos/seed/forum-a/900/520',
  'https://picsum.photos/seed/forum-b/900/520',
  'https://picsum.photos/seed/forum-c/900/520',
  'https://picsum.photos/seed/forum-d/900/520',
  'https://picsum.photos/seed/forum-e/900/520'
];

const videoPool = [
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
];

const loremSnippets = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus bibendum interdum massa, id consectetur nisl suscipit id.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ultrices in iaculis nunc sed augue lacus viverra vitae.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Mauris cursus mattis molestie a iaculis at erat pellentesque adipiscing commodo elit at imperdiet dui accumsan sit.',
  'Velit ut tortor pretium viverra suspendisse potenti nullam ac tortor vitae purus faucibus ornare suspendisse sed.'
];

function pick(list, index) {
  return list[index % list.length];
}

function buildBody(seed) {
  return [
    pick(loremSnippets, seed),
    pick(loremSnippets, seed + 2),
    pick(loremSnippets, seed + 4)
  ].join(' ');
}

function insertFakeUsers(db) {
  const now = Date.now();
  const baseUsers = [
    {
      username: 'aurora_admin',
      email: 'aurora@example.com',
      display_name: 'Aurora Lane',
      headline: 'Community host and media archivist.',
      bio: buildBody(0),
      accent_color: '#FA8072',
      background_color: '#fff6f7',
      card_color: '#ffffff',
      text_color: '#3f4a56',
      theme_mode: 'light'
    },
    {
      username: 'pixelpilot',
      email: 'pixelpilot@example.com',
      display_name: 'Pixel Pilot',
      headline: 'Daily uploader of concept clips.',
      bio: buildBody(1),
      accent_color: '#ff4a4a',
      background_color: '#f8f8ff',
      card_color: '#fefefe',
      text_color: '#303740',
      theme_mode: 'dark'
    },
    {
      username: 'salmonsky',
      email: 'salmonsky@example.com',
      display_name: 'Salmon Sky',
      headline: 'Photos, reels, and pastel UI experiments.',
      bio: buildBody(2),
      accent_color: '#f49b9b',
      background_color: '#fff7f8',
      card_color: '#ffffff',
      text_color: '#434b56',
      theme_mode: 'light'
    },
    {
      username: 'canarybyte',
      email: 'canarybyte@example.com',
      display_name: 'Canary Byte',
      headline: 'Search optimization and metadata nerd.',
      bio: buildBody(3),
      accent_color: '#ffd93b',
      background_color: '#fffdf1',
      card_color: '#ffffff',
      text_color: '#323b44',
      theme_mode: 'light'
    },
    {
      username: 'slatewave',
      email: 'slatewave@example.com',
      display_name: 'Slate Wave',
      headline: 'Forum reviewer and quality gatekeeper.',
      bio: buildBody(4),
      accent_color: '#6a7480',
      background_color: '#f3f5f7',
      card_color: '#ffffff',
      text_color: '#2e3740',
      theme_mode: 'dark'
    },
    {
      username: 'modularmint',
      email: 'modularmint@example.com',
      display_name: 'Modular Mint',
      headline: 'Build logs and template packs every week.',
      bio: buildBody(5),
      accent_color: '#ff6b6b',
      background_color: '#fff7f7',
      card_color: '#ffffff',
      text_color: '#3b4350',
      theme_mode: 'light'
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (
      username, email, password_hash, display_name, headline, bio,
      avatar_url, theme_mode, accent_color, background_color, card_color,
      text_color, title_font, body_font, section_order,
      hide_activity, hide_media, hide_reviews, hide_comment_board, created_at
    ) VALUES (
      @username, @email, @password_hash, @display_name, @headline, @bio,
      @avatar_url, @theme_mode, @accent_color, @background_color, @card_color,
      @text_color, @title_font, @body_font, @section_order,
      @hide_activity, @hide_media, @hide_reviews, @hide_comment_board, @created_at
    )
  `);

  const hashed = bcrypt.hashSync('password123', 10);

  baseUsers.forEach((user, i) => {
    insertUser.run({
      ...user,
      password_hash: hashed,
      avatar_url: `https://placehold.co/240x240/png?text=${encodeURIComponent(user.display_name.split(' ')[0])}`,
      title_font: '"Baloo 2"',
      body_font: '"Montserrat"',
      section_order: 'about,activity,media,reviews,comment_board',
      hide_activity: 0,
      hide_media: 0,
      hide_reviews: i % 5 === 0 ? 1 : 0,
      hide_comment_board: 0,
      created_at: new Date(now - i * 86400000).toISOString()
    });
  });
}

function insertFakeThreads(db) {
  const userIds = db.prepare('SELECT id FROM users ORDER BY id').all().map((row) => row.id);
  const insertThread = db.prepare(`
    INSERT INTO threads (
      user_id, category_slug, topic_tag, title, body, media_type, media_url, created_at
    ) VALUES (
      @user_id, @category_slug, @topic_tag, @title, @body, @media_type, @media_url, @created_at
    )
  `);

  let seed = 0;
  const created = [];
  const now = Date.now();

  for (let i = 0; i < 90; i += 1) {
    const category = pick(categories, i);
    const userId = pick(userIds, i);
    const topic = pick(forumTopics, i * 2);
    const mediaType = i % 3 === 0 ? 'image' : i % 5 === 0 ? 'video' : 'text';

    const info = {
      user_id: userId,
      category_slug: category.slug,
      topic_tag: topic,
      title: `${topic}: Placeholder thread #${i + 1}`,
      body: buildBody(seed),
      media_type: mediaType,
      media_url:
        mediaType === 'image' ? pick(imagePool, i) : mediaType === 'video' ? pick(videoPool, i) : null,
      created_at: new Date(now - i * 7200000).toISOString()
    };

    const result = insertThread.run(info);
    created.push(result.lastInsertRowid);
    seed += 1;
  }

  const insertComment = db.prepare(`
    INSERT INTO thread_comments (thread_id, user_id, body, created_at)
    VALUES (@thread_id, @user_id, @body, @created_at)
  `);

  created.slice(0, 60).forEach((threadId, i) => {
    insertComment.run({
      thread_id: threadId,
      user_id: pick(userIds, i + 1),
      body: `Great thread. ${buildBody(i + 1)}`,
      created_at: new Date(now - i * 3600000).toISOString()
    });

    insertComment.run({
      thread_id: threadId,
      user_id: pick(userIds, i + 2),
      body: `Second viewpoint here. ${buildBody(i + 2)}`,
      created_at: new Date(now - i * 3200000).toISOString()
    });
  });
}

function insertFakeReviews(db) {
  const userIds = db.prepare('SELECT id FROM users ORDER BY id').all().map((row) => row.id);
  const insert = db.prepare(`
    INSERT INTO reviews (user_id, title, body, rating, created_at)
    VALUES (@user_id, @title, @body, @rating, @created_at)
  `);

  const now = Date.now();
  for (let i = 0; i < 36; i += 1) {
    insert.run({
      user_id: pick(userIds, i),
      title: `Placeholder review #${i + 1}`,
      body: buildBody(i),
      rating: (i % 5) + 1,
      created_at: new Date(now - i * 5400000).toISOString()
    });
  }
}

function insertFakeMedia(db) {
  const userIds = db.prepare('SELECT id FROM users ORDER BY id').all().map((row) => row.id);
  const insert = db.prepare(`
    INSERT INTO media_posts (user_id, title, description, media_type, media_url, created_at)
    VALUES (@user_id, @title, @description, @media_type, @media_url, @created_at)
  `);

  const now = Date.now();
  for (let i = 0; i < 48; i += 1) {
    const mediaType = i % 4 === 0 ? 'video' : 'image';
    insert.run({
      user_id: pick(userIds, i),
      title: `Media drop #${i + 1}`,
      description: buildBody(i + 3),
      media_type: mediaType,
      media_url: mediaType === 'video' ? pick(videoPool, i) : pick(imagePool, i),
      created_at: new Date(now - i * 4100000).toISOString()
    });
  }
}

function insertFakeProfileComments(db) {
  const users = db.prepare('SELECT id FROM users ORDER BY id').all();
  const insert = db.prepare(`
    INSERT INTO profile_comments (profile_user_id, author_user_id, body, created_at)
    VALUES (@profile_user_id, @author_user_id, @body, @created_at)
  `);

  const now = Date.now();
  for (let i = 0; i < users.length * 4; i += 1) {
    const profileUser = users[i % users.length];
    const author = users[(i + 1) % users.length];

    insert.run({
      profile_user_id: profileUser.id,
      author_user_id: author.id,
      body: `Profile board note #${i + 1}. ${buildBody(i + 2)}`,
      created_at: new Date(now - i * 2300000).toISOString()
    });
  }
}

function seedIfNeeded(db) {
  const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (existingUsers > 0) {
    return false;
  }

  const transaction = db.transaction(() => {
    insertFakeUsers(db);
    insertFakeThreads(db);
    insertFakeReviews(db);
    insertFakeMedia(db);
    insertFakeProfileComments(db);
  });

  transaction();
  return true;
}

module.exports = {
  seedIfNeeded
};
