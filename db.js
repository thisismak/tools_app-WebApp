const mysql = require('mysql2/promise');
const fs = require('fs').promises;
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00'
});

async function query(sql, params) {
  try {
    const [results, fields] = await pool.query(sql, params);
    console.log('SQL 查詢成功:', { sql, params, results });
    return sql.trim().toUpperCase().startsWith('SELECT') ? (Array.isArray(results) ? results : []) : results;
  } catch (err) {
    console.error('Query Error:', { sql, params, error: err.message, stack: err.stack });
    throw err;
  }
}

async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    const sql = await fs.readFile('init.sql', 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const statement of statements) {
      await connection.query(statement);
    }
    console.log('Database initialized successfully');
    connection.release();
  } catch (err) {
    console.error('Database Initialization Error:', err.message);
    throw err;
  }
}

module.exports = { pool, query, initializeDatabase };
