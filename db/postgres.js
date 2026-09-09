'use strict';

// PostgreSQL connection layer for CAMS.
// This module is intentionally independent from the existing SQLite/Firestore
// stack so the application can be cut over table-by-table without downtime.
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'civil_affairs',
  user: process.env.DB_USER || 'cams_app',
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  allowExitOnIdle: true
});

pool.on('error', error => {
  console.error('[postgres] Unexpected idle-client error:', error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function many(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function healthcheck() {
  const result = await pool.query('SELECT NOW() AS now');
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  one,
  many,
  transaction,
  healthcheck
};
