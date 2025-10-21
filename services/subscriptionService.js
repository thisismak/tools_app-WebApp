const { query } = require('../db');

async function saveSubscription(userId, subscription) {
  const [existing] = await query('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  if (existing.length > 0) {
    await query('UPDATE push_subscriptions SET subscription = ?, created_at = NOW() WHERE user_id = ?', 
      [JSON.stringify(subscription), userId]);
    console.log('推送訂閱更新成功:', userId, subscription.endpoint);
  } else {
    await query('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', 
      [userId, JSON.stringify(subscription)]);
    console.log('推送訂閱新增成功:', userId, subscription.endpoint);
  }
}

async function getSubscription(userId) {
  const [results] = await query('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [userId]);
  if (results.length === 0) {
    throw new Error('無訂閱記錄');
  }
  return JSON.parse(results[0].subscription);
}

module.exports = { saveSubscription, getSubscription };