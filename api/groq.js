// Vercel Serverless Function - Proxy para Groq API
// Corrige error 413 limitando el tamaño del contexto enviado

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY no configurada en Vercel' });

  try {
    let body = req.body;

    // Correccion error 413: limitar mensajes y contenido
    if (body.messages && Array.isArray(body.messages)) {
      body.messages = body.messages.map(msg => {
        if (typeof msg.content === 'string' && msg.content.length > 8000) {
          return { ...msg, content: msg.content.slice(0, 8000) + '\n[contenido truncado por limite de contexto]' };
        }
        return msg;
      });
      // Mantener solo los ultimos 10 mensajes mas el system prompt
      const systemMsg = body.messages.find(m => m.role === 'system');
      const otherMsgs = body.messages.filter(m => m.role !== 'system').slice(-9);
      body.messages = systemMsg ? [systemMsg, ...otherMsgs] : otherMsgs;
    }

    // Limitar max_tokens para evitar 413
    body.max_tokens = Math.min(body.max_tokens || 1024, 4096);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || 'Error en Groq' });
    return res.status(200).json(data);

  } catch (err) {
    console.error('Error en proxy Groq:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
