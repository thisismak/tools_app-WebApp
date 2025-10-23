const { query } = require('../db');

async function saveSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) {
    console.error('無效的訂閱物件:', { userId, subscription });
    throw new Error('無效的推送訂閱數據');
  }
  const existing = await query('SELECT * FROM push_subscriptions WHERE user_id = ? AND JSON_EXTRACT(subscription, "$.endpoint") = ?', [userId, subscription.endpoint]);
  if (!Array.isArray(existing)) {
    console.error('查詢結果無效:', { userId, existing });
    throw new Error('查詢訂閱記錄失敗');
  }
  if (existing.length > 0) {
    console.log('訂閱已存在，跳過保存:', userId, subscription.endpoint);
    return;
  }
  await query('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)',
    [userId, JSON.stringify(subscription)]);
  console.log('推送訂閱新增成功:', userId, subscription.endpoint);
}

async function getSubscription(userId) {
  const results = await query('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [userId]);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('無訂閱記錄');
  }
  return JSON.parse(results[0].subscription);
}

module.exports = { saveSubscription, getSubscription };