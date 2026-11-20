const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { OpenAI } = require('openai');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(cors());

const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'admin',
  database: 'sakila',
});

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://mi-agente-ia.com',
    'X-Title': 'Mi Agente IA',
  },
});

async function queryDB(sql) {
  const [rows] = await db.query(sql);
  return rows;
}

async function obtenerContexto() {
  const peliculas = await queryDB(`
    SELECT f.title, f.length, COUNT(r.rental_id) as total_rentals
    FROM film f
    JOIN film_category fc ON f.film_id = fc.film_id
    JOIN category c ON fc.category_id = c.category_id
    JOIN inventory i ON f.film_id = i.film_id
    JOIN rental r ON i.inventory_id = r.inventory_id
    WHERE c.name = 'Action' AND f.length > 120
    GROUP BY f.film_id
    ORDER BY total_rentals DESC
    LIMIT 3
  `);

  const clientesInactivos = await queryDB(`
    SELECT c.first_name, c.last_name,
           MAX(r.rental_date) as ultimo_alquiler,
           DATEDIFF(NOW(), MAX(r.rental_date)) as dias_inactivo
    FROM customer c
    JOIN rental r ON c.customer_id = r.customer_id
    GROUP BY c.customer_id
    HAVING dias_inactivo > 200
    ORDER BY dias_inactivo DESC
    LIMIT 10
  `);

  const movimientoDias = await queryDB(`
    SELECT DAYNAME(p.payment_date) as dia,
           COUNT(p.payment_id) as total_rentas,
           ROUND(SUM(p.amount), 2) as dinero_total
    FROM payment p
    GROUP BY DAYNAME(p.payment_date)
    ORDER BY total_rentas DESC
  `);

  return { peliculas, clientesInactivos, movimientoDias };
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    console.log('Mensaje recibido:', message);

    const datos = await obtenerContexto();
    console.log('Datos de Sakila obtenidos correctamente');

    const messages = [
      {
        role: 'system',
        content: `Eres un agente experto en análisis de datos de la tienda de renta de películas Sakila. 
SIEMPRE responde usando ÚNICAMENTE estos datos reales de la base de datos:

PELÍCULAS DE ACCIÓN LARGAS MÁS ALQUILADAS:
${JSON.stringify(datos.peliculas, null, 2)}

CLIENTES INACTIVOS (sin alquilar hace más de 200 días):
${JSON.stringify(datos.clientesInactivos, null, 2)}

MOVIMIENTO POR DÍA DE LA SEMANA:
${JSON.stringify(datos.movimientoDias, null, 2)}

Responde en español, de forma clara y detallada, mencionando los nombres y números exactos de los datos.`
      },
      ...(history || []),
      { role: 'user', content: message }
    ];

    const completion = await openrouter.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      messages,
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno al procesar la solicitud' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));