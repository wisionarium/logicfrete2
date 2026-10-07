export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.LOGIC_FRETE_WEBHOOK_SECRET;

    if (!expectedToken) {
      console.error("ERRO: LOGIC_FRETE_WEBHOOK_SECRET n�o est� configurado na Vercel.");
      return res.status(500).json({ error: 'Erro de configura��o do servidor.' });
    }

    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.split(' ')[1].trim() 
      : (authHeader ? authHeader.trim() : null);

    const safeExpectedToken = expectedToken.trim();

    if (token !== safeExpectedToken) {
      return res.status(401).json({ error: 'N�o Autorizado. Token inv�lido.' });
    }

    const { event, sale_id, ...data } = req.body;
    
    if (!sale_id) {
       return res.status(400).json({ error: 'O campo sale_id � obrigat�rio.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
       return res.status(500).json({ error: 'Erro de configura��o do banco.' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation'
    };

    if (event === 'sale.created') {
      // 1. Check if delivery already exists
      const getRes = await fetch(`${supabaseUrl}/rest/v1/pending_deliveries?sale_id=eq.${sale_id}`, { method: 'GET', headers });
      const existing = await getRes.json();
      
      const payload = {
        sale_id: sale_id,
        store_name: data.store_name || null,
        client_name: data.client_name || null,
        client_phone: data.client_phone || null,
        client_cpf: data.client_cpf || null,
        client_address: data.client_address || null,
        client_cep: data.client_cep || null,
        client_reference: data.client_reference || null,
        product_name: data.product_name || null,
        variant_name: data.variant_name || null,
        delivery_date: data.delivery_date || null,
        observations: data.observations || null,
        status: 'pending'
      };

      let response;
      if (existing && existing.length > 0) {
        // Update
        response = await fetch(`${supabaseUrl}/rest/v1/pending_deliveries?sale_id=eq.${sale_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        // Insert
        response = await fetch(`${supabaseUrl}/rest/v1/pending_deliveries`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: 'Falha ao salvar', details: err });
      }

      const insertedData = await response.json();
      return res.status(200).json({ success: true, message: 'Entrega salva com sucesso!', data: insertedData });

    } else if (event === 'sale.cancelled') {
      // Delete from pending_deliveries
      const response = await fetch(`${supabaseUrl}/rest/v1/pending_deliveries?sale_id=eq.${sale_id}`, {
        method: 'DELETE',
        headers
      });
      
      // We also could try deleting from 'deliveries' table just in case it's already routed
      await fetch(`${supabaseUrl}/rest/v1/deliveries?sale_id=eq.${sale_id}`, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: 'Falha ao cancelar', details: err });
      }

      return res.status(200).json({ success: true, message: 'Entrega cancelada/removida com sucesso!' });

    } else {
      return res.status(400).json({ error: `Evento desconhecido: ${event}` });
    }

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

