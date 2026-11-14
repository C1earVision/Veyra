require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');

const cleanPassword = (pw) => {
  if (!pw) return pw;
  if ((pw.startsWith('"') && pw.endsWith('"')) || (pw.startsWith("'") && pw.endsWith("'"))) {
    return pw.slice(1, -1);
  }
  return pw;
};

const server = process.env.DATABASE_SERVER || 'localhost';
const port = parseInt(process.env.DATABASE_PORT || '5432', 10);
const user = process.env.DATABASE_USER_NAME || 'postgres';
const password = cleanPassword(process.env.DATABASE_PASS || 'postgres');
const dbName = process.env.DATABASE_NAME || 'HardWare';
const useSsl =
  process.env.DATABASE_SSL === 'true' ||
  server.includes('supabase');
const skipCreateDatabase =
  process.env.SKIP_CREATE_DATABASE === 'true' || server.includes('supabase');

const sslConfig = useSsl ? { ssl: { rejectUnauthorized: false } } : {};

const ddl = `
CREATE TABLE IF NOT EXISTS "users" (
    "CustomerId" SERIAL PRIMARY KEY,
    "Password" VARCHAR(255) NOT NULL,
    "Name" VARCHAR(255) NOT NULL,
    "Email" VARCHAR(255) UNIQUE NOT NULL,
    "DateOfBirth" DATE,
    "Country" VARCHAR(100),
    "City" VARCHAR(100),
    "Street" VARCHAR(255),
    "State" VARCHAR(100),
    "ZIP" INTEGER,
    "AdminState" INTEGER DEFAULT 0,
    "SubscriptionTier" VARCHAR(50) DEFAULT 'Free Access'
);

CREATE TABLE IF NOT EXISTS "AgentVisualization" (
    "VisualizationId" UUID PRIMARY KEY,
    "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Img" BYTEA NOT NULL
);
`;

async function main() {
  if (!skipCreateDatabase) {
    const client = new Client({
      host: server,
      port: port,
      user: user,
      password: password,
      database: 'postgres',
      ...sslConfig,
    });

    try {
      await client.connect();
      console.log('Connected to template database "postgres" to check database presence...');

      const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (res.rowCount === 0) {
        console.log(`Database "${dbName}" does not exist. Creating...`);
        await client.query(`CREATE DATABASE "${dbName}"`);
        console.log(`Database "${dbName}" created successfully.`);
      } else {
        console.log(`Database "${dbName}" already exists.`);
      }
    } catch (err) {
      console.error('Error checking/creating database:', err);
      process.exit(1);
    } finally {
      await client.end();
    }
  } else {
    console.log('Skipping CREATE DATABASE step (Supabase / managed Postgres).');
  }

  const dbClient = new Client({
    host: server,
    port: port,
    user: user,
    password: password,
    database: dbName,
    ...sslConfig,
  });

  try {
    await dbClient.connect();
    console.log(`Connected to database "${dbName}". Running DDL script...`);
    await dbClient.query(ddl);
    console.log('DDL schema tables created successfully!');
  } catch (err) {
    console.error('Error running DDL:', err);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

main();
