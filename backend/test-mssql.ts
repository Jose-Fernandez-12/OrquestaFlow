import mssql from 'mssql';
import { getDb } from './src/db/database.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const { initDb } = await import('./src/db/database.js');
  await initDb();
  const db = getDb();
  
  const connInfo = db.prepare('SELECT * FROM connections WHERE driver = ?').get('ODBC Driver 17 for SQL Server') as any;
  if (!connInfo) return;
  
  const key = connInfo.env_credential_key || 'SQLSERVER';
  const user = connInfo.username || process.env[`DB_USER_${key}`] || process.env.DB_USER_DEFAULT || 'sa';
  const password = connInfo.password || process.env[`DB_PASSWORD_${key}`] || process.env.DB_PASSWORD_DEFAULT || 'SecretPassword123!';

  const config = {
    user, password, server: connInfo.host, database: connInfo.database_name, port: Number(connInfo.port || 1433),
    options: { encrypt: true, trustServerCertificate: true }
  };
  
  try {
    const pool = await mssql.connect(config);
    const queries = [
      "EXEC sp_executesql N'SELECT 1 WHERE ''test'' LIKE '%@nombre%''"
    ];
    for (let i = 0; i < queries.length; i++) {
      try {
        await pool.request().query(queries[i]);
      } catch(err) {
        console.log(`ERROR ${i}:`, err.message);
      }
    }
    await pool.close();
  } catch (err) {
    console.log("Connection error", err.message);
  }
}
run();
