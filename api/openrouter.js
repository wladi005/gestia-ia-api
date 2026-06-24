// Vercel Serverless Function - Proxy secundario usando Groq/Llama-3.3-70b
// Reemplaza OpenRouter (plan gratuito agotado)
// Usa la misma GROQ_API_KEY con contexto reducido como segundo intento

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY no configurada en Vercel' });

  try {
    let body = req.body;

    // Contexto mas reducido que el proveedor principal para evitar 413
    if (body.messages && Array.isArray(body.messages)) {
      body.messages = body.messages.map(msg => {
        if (typeof msg.content === 'string' && msg.content.length > 4000) {
          return { ...msg, content: msg.content.slice(0, 4000) + '\n[contenido truncado]' };
        }
        return msg;
      });
      const systemMsg = body.messages.find(m => m.role === 'system');
      const otherMsgs = body.messages.filter(m => m.role !== 'system').slice(-5);
      body.messages = systemMsg ? [systemMsg, ...otherMsgs] : otherMsgs;
    }

    // Forzar modelo Llama 3.3-70b independientemente del modelo solicitado
    body.model = 'llama-3.3-70b-versatile';
    body.max_tokens = Math.min(body.max_tokens || 1024, 2048);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || 'Error en Groq/Llama fallback' });
    return res.status(200).json(data);

  } catch (err) {
    console.error('Error en proxy OpenRouter/Llama fallback:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
