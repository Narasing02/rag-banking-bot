import express from 'express';
import dotenv from 'dotenv';
import ingestionRoutes from './ingestion.js';
import chatRoutes from './chat.js';

dotenv.config();

const app = express();

// Middleware to parse incoming JSON payloads (Crucial for Pipeline 2)
app.use(express.json());

// Mount the routes
// Pipeline 1 will live at: http://localhost:5000/api/ingest/upload
app.use('/api/ingest', ingestionRoutes);

// Pipeline 2 will live at: http://localhost:3000/api/chat/message
app.use('/api/chat', chatRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`RAG Banking Bot server running on port ${PORT}`);
});