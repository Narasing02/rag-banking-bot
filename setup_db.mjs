import pg from 'pg';
import dns from 'dns/promises';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

async function setup() {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: DIRECT_URL or DATABASE_URL must be defined in your .env file.');
    process.exit(1);
  }

  let client;

  try {
    const urlObj = new URL(dbUrl);
    console.log(`Connecting to database at ${urlObj.hostname}:${urlObj.port || 5432}...`);

    let targetHost = urlObj.hostname;

    // Resolve IPv4 address to avoid Windows CNAME / IPv6 timeout issues
    try {
      const addresses = await dns.resolve4(urlObj.hostname);
      if (addresses && addresses.length > 0) {
        targetHost = addresses[0];
      }
    } catch {
      // Fallback to hostname if DNS resolve4 isn't supported or fails
      targetHost = urlObj.hostname;
    }

    client = new Client({
      host: targetHost,
      port: parseInt(urlObj.port || '5432', 10),
      user: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      database: urlObj.pathname.replace(/^\//, '') || 'postgres',
      ssl: {
        servername: urlObj.hostname,
        rejectUnauthorized: false,
      },
      connectionTimeoutMillis: 10000,
    });

    await client.connect();
    console.log('Connected to database successfully!');

    console.log('1. Enabling vector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

    console.log('2. Creating documents table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('3. Creating document_chunks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.document_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(768)
      );
    `);

    console.log('4. Creating match_documents function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION match_documents (
        query_embedding vector(768),
        match_threshold float,
        match_count int
      )
      RETURNS TABLE (
        id uuid,
        document_id uuid,
        content text,
        similarity float
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN QUERY
        SELECT
          document_chunks.id,
          document_chunks.document_id,
          document_chunks.content,
          1 - (document_chunks.embedding <=> query_embedding) AS similarity
        FROM document_chunks
        WHERE 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
        ORDER BY document_chunks.embedding <=> query_embedding
        LIMIT match_count;
      END;
      $$;
    `);

    console.log('5. Creating vector index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
      ON public.document_chunks 
      USING hnsw (embedding vector_cosine_ops);
    `);

    console.log('Database schema and vector functions setup successfully!');
  } catch (err) {
    console.error('Setup failed:', err.message);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

setup();
