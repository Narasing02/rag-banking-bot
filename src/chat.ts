import express from 'express';
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

interface MatchedChunk {
  id: string;
  document_id?: string;
  content: string;
  similarity?: number;
}

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

router.post('/message', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    console.log(`User asked: "${question}"`);

    // STEP 1: Vectorize the User's Question
    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: "gemini-embedding-001",
      outputDimensionality: 768,
      apiKey: process.env.GEMINI_API_KEY!,
    });
    const queryVector = await embeddings.embedQuery(question);

    // STEP 2: Semantic Search (Call the Supabase RPC function)
    const { data: matchedChunks, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector, // The math array we just generated
      match_threshold: 0.7,         // Only return chunks with 70%+ meaning match
      match_count: 3                // Limit to top 3 paragraphs to save AI memory
    });

    if (error) throw new Error(`Search Error: ${error.message}`);

    const chunks = (matchedChunks as MatchedChunk[] | null) ?? [];

    // Check if we found any relevant documents
    if (chunks.length === 0) {
      return res.status(200).json({ 
        answer: "I'm sorry, but I don't have information regarding that in my banking policies." 
      });
    }

    // STEP 3: Construct the Augmented Prompt
    // Combine all the retrieved text chunks into one massive string
    const contextText = chunks.map(chunk => chunk.content).join('\n\n---\n\n');

    const systemPrompt = `
      You are a highly secure, professional banking assistant.
      Answer the user's question using ONLY the provided context below.
      If the answer is not contained within the context, you must strictly say: "I cannot verify that information based on the current banking policies."
      Do NOT make up any interest rates, terms, or policies.
      
      CONTEXT:
      ${contextText}
      
      USER QUESTION:
      ${question}
    `;

    // STEP 4: Generate the Answer using Gemini LLM
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-3-flash-preview",
      apiKey: process.env.GEMINI_API_KEY!,
      temperature: 0.0, // CRITICAL: 0.0 makes it factual and prevents hallucinations
    });

    const aiResponse = await llm.invoke(systemPrompt);

    // STEP 5: Send the secure answer back to the frontend
    res.status(200).json({ 
      answer: aiResponse.content,
      sources: chunks.map(chunk => chunk.id) // Optional: send back source IDs so the frontend can show citations
    });

  } catch (error: any) {
    console.error('Chat failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;