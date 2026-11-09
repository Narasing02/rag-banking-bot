# Project Implementation Guide: Banking RAG Bot

## 1. Project Overview & Mission

**rag-banking-bot** is an enterprise-grade Retrieval-Augmented Generation (RAG) backend service designed specifically for banking and financial customer service. 

In banking domains, factual precision and strict adherence to official policies are mandatory. Hallucinations, invented interest rates, or generic assumptions can lead to compliance violations and financial losses. This system solves that problem by grounding every response in verified bank policy documents stored as vector embeddings in a PostgreSQL vector database (`pgvector`).

---

## 2. Current Project Status

- **System Health:** 🟢 Operational & Verified End-to-End
- **TypeScript:** 🟢 Compiles cleanly (`npx tsc --noEmit` exits with 0 errors)
- **Ingestion Pipeline (`/api/ingest/upload`):** 🟢 Functional (parses PDFs in-memory, chunks text, generates 768-dim embeddings, stores in Supabase)
- **RAG Chat Pipeline (`/api/chat/message`):** 🟢 Functional (vectorizes user question, performs cosine similarity search via `match_documents` RPC, augments prompt, generates factual answers via Gemini with temperature `0.0`)
- **Database (`pgvector`):** 🟢 Configured with tables, HNSW vector index, and stored procedure.
- **Git & GitHub Security:** 🟢 Protected via `.gitignore` and `.env.example` to prevent database and secret exposure.

---

## 3. Architecture & Tech Stack

```
                          ┌────────────────────────┐
                          │   Client / Frontend    │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
   POST /api/ingest/upload                         POST /api/chat/message
   (Multipart Form: PDF)                           (JSON: { question })
              │                                               │
              ▼                                               ▼
     ┌─────────────────┐                             ┌─────────────────┐
     │ Multer (Memory) │                             │ Vectorize Query │
     └────────┬────────┘                             │  (Gemini Embed) │
              │                                      └────────┬────────┘
              ▼                                               │
     ┌─────────────────┐                                      ▼
     │ PDFParse (Text) │                             ┌─────────────────┐
     └────────┬────────┘                             │ Supabase RPC    │
              │                                      │ match_documents │
              ▼                                      └────────┬────────┘
     ┌─────────────────┐                                      │
     │ LangChain Chunk │                                      ▼
     │ (500 char, 100) │                             ┌─────────────────┐
     └────────┬────────┘                             │ Augmented Prompt│
              │                                      │  (Strict Guard) │
              ▼                                      └────────┬────────┘
     ┌─────────────────┐                                      │
     │  Gemini Embed   │                                      ▼
     │   (768 dim)     │                             ┌─────────────────┐
     └────────┬────────┘                             │ Gemini 3 Flash  │
              │                                      │  (temp: 0.0)    │
              ▼                                      └────────┬────────┘
     ┌─────────────────┐                                      │
     │ Supabase Insert │                                      ▼
     │(document_chunks)│                             { answer, sources }
     └─────────────────┘
```

### Components Used:
- **Runtime:** Node.js (ES Modules, TypeScript, `tsx`, `nodemon`)
- **Web Server:** Express 5
- **Orchestration:** LangChain (`@langchain/core`, `@langchain/google-genai`, `@langchain/textsplitters`)
- **AI Models:**
  - **Embedding:** Google Gemini `gemini-embedding-001` (configured with `outputDimensionality: 768`)
  - **LLM / Generation:** Google Gemini `gemini-3-flash-preview` (zero temperature for strict determinism)
- **Database & Vector Search:** Supabase PostgreSQL with `pgvector` extension and HNSW indexing
- **PDF Extraction:** `pdf-parse` v2 (class-based `PDFParse`)
- **File Uploads:** `multer` (in-memory buffer storage)
- **Database Client:** `@supabase/supabase-js` (application queries) & `pg` (automated schema migrations)

---

## 4. GitHub Safety: "Can Database Data Be Visible on GitHub?"

### Question:
> *"I want to push code to my GitHub. Does the DB setup have all data visible? What do we do?"*

### Clear Answer & How Security Works:

1. **Your Database Data Is NOT Stored In Your Repository:**
   - Your data (PDF text chunks and vectors) lives remotely in your cloud-hosted Supabase PostgreSQL database—**not** in your local Git repository files.
   - Pushing your project to GitHub will **not** expose your database data, provided your credentials are kept secret.

2. **The Danger: Credentials in `.env`:**
   - If you accidentally commit `.env`, anyone on GitHub could copy your `DATABASE_URL`, `DIRECT_URL`, or `SUPABASE_SERVICE_ROLE_KEY` and connect directly to your database to view, download, or delete your data.
   - Your `GEMINI_API_KEY` could also be stolen and abused.

3. **What We Did to Protect You:**
   - **Created `.gitignore`:** Added `.env`, `node_modules/`, and build artifacts so Git will permanently ignore them and never stage them.
   - **Created `.env.example`:** Created a sanitized template with placeholder values (`your_api_key_here`) for other developers to know what variables are required.
   - **Sanitized `setup_db.mjs`:** Removed all hardcoded credentials from the database script so that it reads strictly from environment variables.

---

## 5. Challenges Encountered & Exact Solutions Applied

### Challenge 1: `pdf-parse` v2 Breaking API Change
- **Symptom:** Ingestion endpoint returned `500 Internal Server Error` with `{"error": "pdfParse is not a function"}`.
- **Root Cause:** Version `^2.4.5` of `pdf-parse` was installed. In v2, the library dropped the legacy default function export (`pdfParse(buffer)`) and replaced it with a class-based interface `PDFParse`.
- **Solution:**
  ```typescript
  // Before (v1 style):
  import * as pdfParseModule from 'pdf-parse';
  const pdfParse = (pdfParseModule as any).default || pdfParseModule;
  const pdfData = await pdfParse(file.buffer);

  // After (v2 style):
  import { PDFParse } from 'pdf-parse';
  const parser = new PDFParse({ data: file.buffer });
  const pdfData = await parser.getText();
  const rawText = pdfData.text;
  ```

---

### Challenge 2: Gemini Embedding & Chat Model Deprecation (404 Errors)
- **Symptom:**
  - Ingestion failed with: `[GoogleGenerativeAI Error]: [404 Not Found] models/text-embedding-004 is not found for API version v1beta`.
  - Chat failed with: `[GoogleGenerativeAI Error]: [404 Not Found] models/gemini-1.5-flash is not found for API version v1beta`.
- **Root Cause:**
  Google Generative AI updated the `v1beta` endpoint lifecycle. Legacy models `text-embedding-004` and `gemini-1.5-flash` were no longer accessible under the current API key/version.
- **Solution:**
  - Queried Google AI's `ListModels` API to find all supported models.
  - Used `gemini-embedding-001` with `outputDimensionality: 768` to produce 768-dimensional embeddings matching the `vector(768)` database schema.
  - Used `gemini-3-flash-preview` for generation with `temperature: 0.0`.
  ```typescript
  // Embedding:
  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-001",
    outputDimensionality: 768,
    apiKey: process.env.GEMINI_API_KEY!,
  });

  // LLM:
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-3-flash-preview",
    apiKey: process.env.GEMINI_API_KEY!,
    temperature: 0.0,
  });
  ```

---

### Challenge 3: Uninitialized Database & Missing `match_documents` RPC
- **Symptom:**
  - Vector similarity search failed with Supabase PostgREST error:
    `PGRST202: Could not find the function public.match_documents(match_count, match_threshold, query_embedding) in the schema cache`.
  - Tables query returned: `PGRST205: Could not find the table 'public.documents'`.
- **Root Cause:**
  The PostgreSQL database had not been migrated; neither the tables, the `vector` extension, nor the similarity function existed.
- **Solution:**
  Created and executed `setup_db.mjs` which automatically creates:
  1. `CREATE EXTENSION IF NOT EXISTS vector;`
  2. `documents` table (`id UUID`, `filename TEXT`, `created_at TIMESTAMPTZ`)
  3. `document_chunks` table (`id UUID`, `document_id UUID`, `content TEXT`, `embedding vector(768)`)
  4. HNSW cosine index `document_chunks_embedding_idx`
  5. Stored function `match_documents`:
     ```sql
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
     ```

---

### Challenge 4: Prisma 7 Configuration Migration
- **Symptom:** Running `npx prisma db push` threw:
  `P1012: The datasource property 'url' is no longer supported in schema files.`
- **Root Cause:** Prisma 7 moved database connection URLs out of `schema.prisma` into a dedicated configuration file `prisma.config.ts`.
- **Solution:**
  - Removed `url = env("DIRECT_URL")` from `prisma/schema.prisma`.
  - Created `prisma.config.ts`:
    ```typescript
    import { defineConfig } from "prisma/config";
    import dotenv from "dotenv";

    dotenv.config();

    export default defineConfig({
      schema: "prisma/schema.prisma",
      datasource: {
        url: process.env.DIRECT_URL!,
      },
    });
    ```

---

### Challenge 5: Windows DNS & Supabase Connection Timeout
- **Symptom:**
  Direct PostgreSQL connections to `aws-0-ap-southeast-2.pooler.supabase.com:5432` hung until timing out or failing with `ENOTFOUND`.
- **Root Cause:**
  The Supabase pooler domain uses multi-tier CNAME aliases pointing to AWS ELB addresses. On Windows, Node's `getaddrinfo` frequently attempts IPv6 addresses first (`64:ff9b::...`) that fail or hang on NAT64 networks.
- **Solution:**
  In `setup_db.mjs`, added automatic DNS IPv4 resolution (`dns.resolve4(urlObj.hostname)`) while setting `ssl.servername: urlObj.hostname` to preserve SNI verification.

---

### Challenge 6: TypeScript Strict Compilation Errors
- **Symptom:** `npx tsc --noEmit` flagged 7 errors:
  - `TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'`.
  - `TS2379: Argument of type ... is not assignable with 'exactOptionalPropertyTypes: true'`.
  - `TS2532: Object is possibly 'undefined'`.
- **Solution:**
  - Updated relative imports in `src/index.ts` to include `.js` (`./ingestion.js`, `./chat.js`).
  - Added non-null assertions `!` to required environment variables.
  - Refactored chunk indexing loop `for (let i = 0; i < chunks.length; i++)` to `for (const chunk of chunks)`.

---

## 6. How to Run & Test the Project

### 1. Installation
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

### 3. Initialize Database Schema & Vector Extension
Run the automated database setup script:
```bash
npm run db:setup
```

### 4. Start the Development Server
```bash
npm run dev
```
The server will start at `http://localhost:5000`.

---

## 7. API Endpoints & Testing

### Pipeline 1: Document Ingestion
Upload a PDF policy document to be parsed, chunked, and vectorized:
```bash
curl -X POST http://localhost:5000/api/ingest/upload \
  -F "file=@path/to/banking_policy.pdf"
```

**Success Response (200):**
```json
{
  "message": "Ingestion pipeline complete.",
  "chunksProcessed": 12
}
```

---

### Pipeline 2: RAG Q&A Chat
Ask a question grounded in the bank's ingested policies:
```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the minimum balance required for savings accounts?"}'
```

**Response with Source Citation (200):**
```json
{
  "answer": "The minimum daily balance required for standard savings accounts is 500 dollars.",
  "sources": ["6f410cb9-b0cf-41ff-8d36-b143a8195a07"]
}
```

**Response for Out-of-Context Questions (Guardrail Check):**
```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"question": "Who was the first president of the United States?"}'
```
```json
{
  "answer": "I cannot verify that information based on the current banking policies."
}
```

---

## 8. Safe GitHub Push Checklist

Before pushing to GitHub, run these commands to guarantee that no credentials or secrets leave your local machine:

```powershell
# 1. Initialize git if not already initialized
git init

# 2. Check git status to ensure .env is NOT tracked
git status

# 3. Add all allowed files
git add .

# 4. Verify that .env is NOT in the staged files list
git status --short

# 5. Commit and push
git commit -m "feat: complete RAG banking bot with pgvector and Gemini"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```
