export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERPAPI_API_KEY no configurada en Vercel' });

  try {
    const { q, hl = 'es', gl = 've', num = 5 } = req.query;
    if (!q) return res.status(400).json({ error: 'Parametro q requerido' });

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', q);
    url.searchParams.set('hl', hl);
    url.searchParams.set('gl', gl);
    url.searchParams.set('num', num);
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || 'Error en SerpAPI' });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
