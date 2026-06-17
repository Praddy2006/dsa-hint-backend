const mysql = require("mysql2/promise");
require("dotenv").config();

// Create a connection pool instead of a single connection
// A pool reuses connections instead of opening a new one every request
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// Test the connection on startup
pool.getConnection()
  .then(conn => {
    console.log("✓ MySQL connected");
    conn.release();
  })
  .catch(err => {
    console.error("✗ MySQL connection failed:", err.message);
  });

module.exports = pool;