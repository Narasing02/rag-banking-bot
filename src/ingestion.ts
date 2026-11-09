import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Use memory storage so we don't clog the server's hard drive with temp PDFs
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded.' });

    console.log(`Processing: ${file.originalname}`);

    // STEP 1: Insert the parent record into the 'documents' table
    const { data: docRecord, error: docError } = await supabase
      .from('documents')
      .insert({ filename: file.originalname })
      .select('id')
      .single();

    if (docError) throw new Error(`DB Error: ${docError.message}`);

    // STEP 2: Extract text from the PDF buffer
    const parser = new PDFParse({ data: file.buffer });
    const pdfData = await parser.getText();
    const rawText = pdfData.text;

    // STEP 3: Split the text into overlapping chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100, // 100 character overlap to maintain context between chunks
    });
    
    // LangChain creates an array of Document objects
    const chunks = await splitter.createDocuments([rawText]);

    // STEP 4: Initialize Gemini Embeddings
    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: "gemini-embedding-001",
      outputDimensionality: 768,
      apiKey: process.env.GEMINI_API_KEY!,
    });

    // STEP 5: Generate vectors and prepare the bulk insert payload
    const chunkInsertions = [];
    
    for (const chunk of chunks) {
      // Send text to Gemini to get the vector array
      const vector = await embeddings.embedQuery(chunk.pageContent);
      
      chunkInsertions.push({
        document_id: docRecord.id, // Relational link to the parent document
        content: chunk.pageContent,
        embedding: vector
      });
    }

    // STEP 6: Bulk insert the chunks and their vectors into Supabase
    const { error: chunkError } = await supabase
      .from('document_chunks')
      .insert(chunkInsertions);

    if (chunkError) throw new Error(`Chunk Insert Error: ${chunkError.message}`);

    res.status(200).json({ 
      message: 'Ingestion pipeline complete.', 
      chunksProcessed: chunks.length 
    });

  } catch (error: any) {
    console.error('Ingestion failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;