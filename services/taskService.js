const { query } = require('../db');
const moment = require('moment-timezone');

async function getTasks(userId) {
  const results = await query('SELECT * FROM tasks WHERE user_id = ?', [userId]);
  return results.map(task => ({
    ...task,
    due_date: moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DDTHH:mm:ssZ')
  }));
}

async function addTask(userId, title, description, dueDate) {
  if (!title || !dueDate) {
    throw new Error('請提供標題和到期日期');
  }
  if (!moment(dueDate, moment.ISO_8601, true).isValid()) {
    throw new Error('無效的到期日期格式');
  }
  const formattedDueDate = moment.tz(dueDate, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  const [result] = await query(
    'INSERT INTO tasks (user_id, title, description, due_date, notified) VALUES (?, ?, ?, ?, FALSE)',
    [userId, title, description, formattedDueDate]
  );
  console.log('任務儲存成功:', result.insertId);
  return result.insertId;
}

async function editTask(userId, taskId, title, description, dueDate) {
  if (!title || !dueDate) {
    throw new Error('請提供標題和到期日期');
  }
  if (!moment(dueDate, moment.ISO_8601, true).isValid()) {
    throw new Error('無效的到期日期格式');
  }
  const formattedDueDate = moment.tz(dueDate, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  await query(
    'UPDATE tasks SET title = ?, description = ?, due_date = ?, notified = FALSE WHERE id = ? AND user_id = ?',
    [title, description, formattedDueDate, taskId, userId]
  );
  console.log('任務更新成功:', taskId);
}

async function deleteTask(userId, taskId) {
  await query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
  console.log('任務刪除成功:', taskId);
}

async function checkUpcomingTasks() {
  const now = moment().tz('Asia/Hong_Kong');
  const inOneMinute = now.clone().add(1, 'minutes');
  const results = await query(
    'SELECT t.*, ps.subscription FROM tasks t JOIN push_subscriptions ps ON t.user_id = ps.user_id WHERE t.due_date BETWEEN ? AND ? AND t.notified = FALSE',
    [now.format('YYYY-MM-DD HH:mm:ss'), inOneMinute.format('YYYY-MM-DD HH:mm:ss')]
  );
  return results.map(task => ({
    ...task,
    subscription: JSON.parse(task.subscription)
  }));
}

async function markTaskAsNotified(taskId) {
  await query('UPDATE tasks SET notified = TRUE WHERE id = ?', [taskId]);
  console.log('任務通知狀態更新成功:', taskId);
}

module.exports = { getTasks, addTask, editTask, deleteTask, checkUpcomingTasks, markTaskAsNotified };