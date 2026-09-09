'use strict';

// PostgreSQL connection layer for CAMS.
// Supports local development via DB_* variables and hosted deployments
// via DATABASE_URL (for example, a secure tunnel endpoint).
require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const isLocalDatabase = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: isLocalDatabase ? false : { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'civil_affairs',
      user: process.env.DB_USER || 'cams_app',
      password: process.env.DB_PASSWORD,
    };

Object.assign(poolConfig, {
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  allowExitOnIdle: true
});

const pool = new Pool(poolConfig);

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
