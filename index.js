// =============================================
// API para GESTIA-IA en Render
// Usa Neon.tech (PostgreSQL) y Supabase Storage
// =============================================

const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Configurar Supabase (para almacenamiento de archivos)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar PostgreSQL (Neon.tech)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para Neon.tech
  }
});

// Iniciar Express
const app = express();
app.use(cors());
app.use(express.json());

// Middleware para autenticación simple (token)
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
};

// Endpoint: Crear una conversación
app.post('/api/conversations', authenticate, async (req, res) => {
  try {
    const { userId, title = 'Nueva conversación' } = req.body;
    const result = await pool.query(
      'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *',
      [userId, title]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear conversación:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Obtener conversaciones de un usuario
app.get('/api/conversations/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener conversaciones:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Guardar mensajes y archivos
app.post('/api/messages', authenticate, async (req, res) => {
  try {
    const { conversationId, role, content, files = [] } = req.body;

    // Guardar mensaje en Neon.tech
    const messageResult = await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id',
      [conversationId, role, content]
    );
    const messageId = messageResult.rows[0].id;

    // Subir archivos a Supabase Storage
    const fileRecords = [];
    for (const file of files) {
      const fileName = `${Date.now()}-${file.name}`;
      const { error } = await supabase
        .storage
        .from('gestia-files')
        .upload(fileName, Buffer.from(file.content, 'base64'), {
          contentType: file.type,
        });

      if (error) {
        console.error('Error al subir archivo:', error);
        continue;
      }

      // Obtener URL pública del archivo
      const { data: urlData } = supabase
        .storage
        .from('gestia-files')
        .getPublicUrl(fileName);

      // Guardar metadatos en Neon.tech
      const fileRecord = await pool.query(
        'INSERT INTO files (message_id, name, type, size, s3_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [messageId, file.name, file.type, file.size, urlData.publicUrl]
      );
      fileRecords.push(fileRecord.rows[0]);
    }

    // Respuesta simulada de la IA
    const aiResponse = `He recibido tu mensaje: "${content}". ${files.length > 0 ? 'Archivos procesados.' : ''}`;
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'assistant', aiResponse]
    );

    res.json({
      message: { id: messageId, role, content },
      files: fileRecords,
      aiResponse,
    });
  } catch (err) {
    console.error('Error al guardar mensaje:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Buscar mensajes
app.get('/api/search', authenticate, async (req, res) => {
  try {
    const { query } = req.query;
    const result = await pool.query(
      `SELECT
          m.id AS message_id,
          m.conversation_id,
          m.role,
          m.content,
          m.timestamp,
          u.name AS user_name,
          c.title AS conversation_title
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       JOIN users u ON c.user_id = u.id
       WHERE to_tsvector('spanish', m.content) @@ to_tsquery('spanish', $1)
       ORDER BY m.timestamp DESC`,
      [query]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al buscar:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Obtener mensajes de una conversación
app.get('/api/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const result = await pool.query(
      `SELECT m.*, f.id AS file_id, f.name AS file_name, f.type AS file_type, f.s3_url AS file_url
       FROM messages m
       LEFT JOIN files f ON m.id = f.message_id
       WHERE m.conversation_id = $1
       ORDER BY m.timestamp ASC`,
      [conversationId]
    );

    // Agrupar mensajes con sus archivos
    const messages = [];
    let currentMessage = null;
    result.rows.forEach((row) => {
      if (!currentMessage || currentMessage.id !== row.id) {
        currentMessage = {
          id: row.id,
          conversation_id: row.conversation_id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          files: [],
        };
        messages.push(currentMessage);
      }
      if (row.file_id) {
        currentMessage.files.push({
          id: row.file_id,
          name: row.file_name,
          type: row.file_type,
          url: row.file_url,
        });
      }
    });
    res.json(messages);
  } catch (err) {
    console.error('Error al obtener mensajes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API de GESTIA-IA escuchando en el puerto ${PORT}`);
});