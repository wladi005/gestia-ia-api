// =============================================
// API para GESTIA-IA en Railway
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
    rejectUnauthorized: false // ✅ Requerido para Neon.tech
  }
});

// Iniciar Express
const app = express();
app.use(cors({
  origin: 'https://index-html-b9p15vudq-wladi005s-projects.vercel.app', // ✅ Dominio de tu frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Middleware para autenticación simple (token)
const authenticate = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // ✅ Extrae el token del header
    if (!token || token !== process.env.API_TOKEN) {
      return res.status(401).json({ error: 'No autorizado' }); // ✅ 401 para token inválido
    }
    next();
  } catch (err) {
    console.error('Error en middleware de autenticación:', err);
    res.status(500).json({ error: 'Error interno en autenticación' });
  }
};

// ✅ Aplicar el middleware de autenticación a TODAS las rutas
app.use(authenticate);

// =============================================
// Rutas de la API
// =============================================

// Ruta para obtener conversaciones de un usuario
app.get('/api/conversations/:userId', async (req, res) => {
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

// Ruta para crear una nueva conversación
app.post('/api/conversations', async (req, res) => {
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

// Ruta para enviar mensajes
app.post('/api/messages', async (req, res) => {
  try {
    const { conversationId, role, content, files = [] } = req.body;

    // 1. Validar que conversationId exista
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId es requerido' });
    }

    // 2. Guardar mensaje en Neon.tech
    const messageResult = await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id',
      [conversationId, role, content]
    );
    const messageId = messageResult.rows[0].id;

    // 3. Subir archivos a Supabase (si los hay)
    const fileRecords = [];
    for (const file of files) {
      try {
        const fileName = `${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase
          .storage
          .from('gestia-files') // ✅ Asegúrate de que este bucket exista en Supabase
          .upload(fileName, Buffer.from(file.content, 'base64'), {
            contentType: file.type,
          });

        if (uploadError) {
          console.error('Error al subir archivo a Supabase:', uploadError);
          continue; // Saltar este archivo si falla
        }

        // Obtener la URL pública del archivo
        const { data: urlData } = supabase
          .storage
          .from('gestia-files')
          .getPublicUrl(fileName);

        // Guardar el registro del archivo en Neon.tech
        const fileRecord = await pool.query(
          'INSERT INTO files (message_id, name, type, size, s3_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [messageId, file.name, file.type, file.size, urlData.publicUrl]
        );
        fileRecords.push(fileRecord.rows[0]);
      } catch (fileErr) {
        console.error('Error al procesar archivo:', fileErr);
        continue; // Saltar este archivo si falla
      }
    }

    // 4. Respuesta simulada de la IA
    const aiResponse = `He recibido tu mensaje: "${content}". ${files.length > 0 ? 'Archivos adjuntos procesados.' : ''}`;

    // 5. Guardar respuesta de la IA en la base de datos
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'assistant', aiResponse]
    );

    // 6. Enviar respuesta al frontend
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

// Ruta para buscar en el historial
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    const result = await pool.query(
      `SELECT * FROM messages
       WHERE to_tsvector('spanish', content) @@ plainto_tsquery('spanish', $1)
       ORDER BY timestamp DESC`,
      [query]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al buscar:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Iniciar el servidor
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de GESTIA-IA escuchando en el puerto ${PORT}`);
});
